import fs from "node:fs/promises";
import path from "node:path";
import {
  managedFileHash,
  readCatalogTokens,
  withTokenFiles,
  type Catalog,
  type CatalogComponent,
  type CatalogSource,
  type CatalogToken,
  type Index,
} from "@dsmith-dev/core";
import type { DetectResult } from "@dsmith-dev/detect";
import { findInitDir, readInitHashes } from "./init-dir.js";
import { catalogFromDir } from "./local.js";
import { compareCodeUnits } from "./names.js";
import { catalogFromPackage } from "./npm.js";
import { findStories, storyExample } from "./stories.js";

export interface BuildCatalogOptions {
  root: string;
  detect: DetectResult;
  index: Index;
  version: string;
  /** 기본 auto */
  from?: "auto" | "ds" | "init";
}

export interface BuildCatalogResult {
  catalog: Catalog;
  warnings: string[];
}

const NO_DS_ERROR = "DS를 찾지 못함: detect.ds가 none이고 init 산출도 없음 — 먼저 `dsmith init`";

async function attachExamples(root: string, dir: string, components: CatalogComponent[]): Promise<void> {
  const stories = await findStories(root, dir);
  for (const comp of components) {
    const file = stories.get(comp.name);
    if (file === undefined) continue;
    try {
      const code = storyExample(await fs.readFile(path.join(root, file), "utf-8"), file);
      if (code !== null) comp.examples = [{ file, code }];
    } catch {
      // 예제는 선택 정보 — 읽지 못하면 건너뛴다
    }
  }
}

/** init이 쓴 뒤 한 글자도 안 바뀐 파일(현재 해시 == `init.json` 엔트리)은 아직 골격이다 → status "scaffold" */
async function markScaffolds(root: string, components: CatalogComponent[]): Promise<void> {
  const hashes = await readInitHashes(root);
  if (hashes.size === 0) return;
  for (const comp of components) {
    if (comp.file === undefined) continue;
    const recorded = hashes.get(comp.file);
    if (recorded === undefined) continue;
    try {
      if (managedFileHash(await fs.readFile(path.join(root, comp.file), "utf-8")) === recorded) comp.status = "scaffold";
    } catch {
      // 못 읽으면 골격으로 단정하지 않는다
    }
  }
}

export async function buildCatalog(opts: BuildCatalogOptions): Promise<BuildCatalogResult> {
  const { root, detect, index, version } = opts;
  const from = opts.from ?? "auto";
  const warnings: string[] = [];
  const sources: CatalogSource[] = [];
  const components: CatalogComponent[] = [];

  const initDir = from === "ds" ? null : await findInitDir(root);
  const ds = detect.ds;
  if (from !== "init" && ds.kind === "none" && (from === "ds" || initDir === null)) throw new Error(NO_DS_ERROR);

  if (from !== "init") {
    if (ds.kind === "local" && ds.dir !== undefined) {
      const res = await catalogFromDir(root, ds.dir, "ds-local", index);
      await attachExamples(root, ds.dir, res.components);
      sources.push({ origin: "ds-local", dir: ds.dir });
      components.push(...res.components);
      warnings.push(...res.warnings);
    } else if (ds.kind === "npm" && ds.packageName !== undefined) {
      const res = await catalogFromPackage(root, ds.packageName, index);
      sources.push(res.source);
      components.push(...res.components);
      warnings.push(...res.warnings);
    }
  }

  if (from !== "ds") {
    if (initDir === null) {
      if (from === "init") warnings.push("init 산출 디렉터리를 찾지 못함 — 먼저 `dsmith init`");
    } else {
      const compDir = initDir === "." ? "components" : `${initDir}/components`;
      const res = await catalogFromDir(root, compDir, "init", index);
      await attachExamples(root, compDir, res.components);
      await markScaffolds(root, res.components);
      sources.push({ origin: "init", dir: compDir });
      components.push(...res.components);
      warnings.push(...res.warnings);
    }
  }

  const initTokens = initDir !== null ? (initDir === "." ? "tokens.json" : `${initDir}/tokens.json`) : null;
  const tokenFiles = [...new Set([...ds.tokenFiles, ...(initTokens !== null ? [initTokens] : [])])];
  const read = await readCatalogTokens(root, tokenFiles);
  const tokens: CatalogToken[] = read.tokens;
  warnings.push(...read.warnings);
  for (const f of read.ignored) warnings.push(`토큰 파일 형식을 읽지 않음(건너뜀): ${f}`);

  const rank = (c: CatalogComponent): number => (c.origin === "init" ? 1 : 0);
  components.sort((a, b) => rank(a) - rank(b) || compareCodeUnits(a.name, b.name) || compareCodeUnits(a.module, b.module));

  const catalog: Catalog = {
    version: 1,
    dsmith: version,
    sources: withTokenFiles(sources, read.files, initTokens),
    components,
    tokens,
    stats: {
      components: components.length,
      propsOk: components.filter((c) => c.propsStatus === "ok").length,
      deprecated: components.filter((c) => c.deprecated !== undefined).length,
      tokens: tokens.length,
    },
  };
  return { catalog, warnings };
}
