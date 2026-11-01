import fs from "node:fs/promises";
import path from "node:path";
import {
  loadTokens,
  type Catalog,
  type CatalogComponent,
  type CatalogSource,
  type CatalogToken,
  type Index,
} from "@dsmith-dev/core";
import type { DetectResult } from "@dsmith-dev/detect";
import { findInitDir } from "./init-dir.js";
import { catalogFromDir } from "./local.js";
import { compareCodeUnits } from "./names.js";
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

/** 토큰 이름 → 읽은 파일(먼저 읽은 파일 우선). loadTokens가 파일 정보를 주지 않으므로 파일별로 한 번씩 더 읽는다 */
async function tokenFileMap(root: string, files: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of files) {
    const loaded = await loadTokens(root, [file], []);
    for (const t of loaded.tokens) {
      if (t.source === "token-file" && !out.has(t.name)) out.set(t.name, file);
    }
  }
  return out;
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
    }
  }

  if (from !== "ds") {
    if (initDir === null) {
      if (from === "init") warnings.push("init 산출 디렉터리를 찾지 못함 — 먼저 `dsmith init`");
    } else {
      const compDir = initDir === "." ? "components" : `${initDir}/components`;
      const res = await catalogFromDir(root, compDir, "init", index);
      await attachExamples(root, compDir, res.components);
      sources.push({ origin: "init", dir: compDir });
      components.push(...res.components);
      warnings.push(...res.warnings);
    }
  }

  const tokenFiles = [
    ...new Set([...ds.tokenFiles, ...(initDir !== null ? [initDir === "." ? "tokens.json" : `${initDir}/tokens.json`] : [])]),
  ];
  const loaded = await loadTokens(root, tokenFiles, []);
  const fileOf = await tokenFileMap(root, loaded.files);
  const tokens: CatalogToken[] = [];
  for (const t of loaded.tokens) {
    if (t.source !== "token-file") continue;
    tokens.push({
      name: t.name,
      value: t.value,
      normalized: t.normalized,
      category: t.category,
      file: fileOf.get(t.name) ?? loaded.files[0] ?? "",
    });
  }
  tokens.sort((a, b) => compareCodeUnits(a.file, b.file) || compareCodeUnits(a.name, b.name));
  warnings.push(...loaded.warnings.filter((w) => !w.startsWith("토큰 파일에서 색 토큰")));

  const rank = (c: CatalogComponent): number => (c.origin === "init" ? 1 : 0);
  components.sort((a, b) => rank(a) - rank(b) || compareCodeUnits(a.name, b.name) || compareCodeUnits(a.module, b.module));

  const catalog: Catalog = {
    version: 1,
    dsmith: version,
    sources,
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
