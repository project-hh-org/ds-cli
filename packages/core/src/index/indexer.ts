import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import picomatch from "picomatch";
import { JS_FILES } from "@dsmith/extractor-api";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith/extractor-api";
import type { ComponentUsage } from "../model/component-usage.js";
import { parseTsx } from "../parse/tsx.js";
import { extractComponentUsage, type ModuleContext } from "./component-usage.js";
import { readTsconfigPaths } from "./specifier.js";

export interface Index {
  root: string;
  createdAt: string;
  extractors: string[];
  files: { scanned: number; skipped: { file: string; reason: string }[] };
  styles: StyleUsage[];
  components: ComponentUsage[];
}

export interface IndexOptions {
  /** 대상 glob. 지정하면 기본값(Extractor가 선언한 files의 합집합 + JS/TS 소스)을 대체한다. */
  include?: string[];
  /** 추가로 제외할 glob. 기본 제외(node_modules, dist, .next, build, coverage, .dsmith)에 더해지며 대체하지 않는다. */
  exclude?: string[];
}

const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/build/**",
  "**/coverage/**",
  "**/.dsmith/**",
];

/** 컴포넌트 사용 분석(Babel 파싱)은 JS/TS 소스에만 적용한다. */
const JS_FILE = /\.[cm]?[jt]sx?$/;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const NUL_PLACEHOLDER_REASON = "NUL 바이트만 있는 파일 — 클라우드 동기화 플레이스홀더일 수 있음";
const NUL_PROBE_BYTES = 512;

/** 비어 있지 않고 앞 512바이트(짧으면 전체)가 모두 0x00인지. 크기는 맞지만 내용이 내려받아지지 않은 동기화 플레이스홀더가 이렇다. */
function isNulPlaceholder(bytes: Buffer): boolean {
  if (bytes.length === 0) return false;
  const end = Math.min(bytes.length, NUL_PROBE_BYTES);
  for (let i = 0; i < end; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

/** baseUrl 디렉터리 바로 아래 항목 이름: 디렉터리와, 확장자를 뗀 JS/TS 소스 파일. 읽지 못하면 빈 집합. */
async function baseUrlEntriesOf(dir: string): Promise<Set<string>> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const names = new Set<string>();
    for (const e of entries) {
      if (e.isDirectory()) names.add(e.name);
      else if (e.isFile() && JS_FILE.test(e.name)) names.add(e.name.replace(JS_FILE, ""));
    }
    return names;
  } catch {
    return new Set();
  }
}

/** root package.json의 dependencies·devDependencies·peerDependencies 이름. 없거나 깨졌으면 빈 집합. */
async function dependencyNamesOf(root: string): Promise<Set<string>> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8")) as Record<string, unknown>;
    const names = new Set<string>();
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = pkg[field];
      if (typeof deps === "object" && deps !== null && !Array.isArray(deps)) {
        for (const name of Object.keys(deps)) names.add(name);
      }
    }
    return names;
  } catch {
    return new Set();
  }
}

export async function indexRepo(
  root: string,
  extractors: Extractor[],
  opts: IndexOptions = {},
): Promise<Index> {
  const include = opts.include ?? [...new Set([...extractors.flatMap((e) => e.files), ...JS_FILES])];
  const files = (
    await fg(include, {
      cwd: root,
      ignore: [...DEFAULT_EXCLUDE, ...(opts.exclude ?? [])],
      absolute: false,
      dot: false,
    })
  )
    .map((f) => f.split(path.sep).join("/"))
    .sort();

  // 준비 단계(설정 파일 로드 등)는 파일을 읽기 전에 Extractor마다 한 번만 실행한다.
  for (const extractor of extractors) {
    try {
      await extractor.prepare?.(root);
    } catch (err) {
      throw new Error(`prepare(${extractor.name}): ${messageOf(err)}`);
    }
  }

  // 컴포넌트 import 해석에 쓸 tsconfig paths·baseUrl 항목·의존성은 레포마다 한 번만 읽는다.
  // baseUrl 항목은 baseUrl을 명시했을 때만 모은다: paths 전용 tsconfig에서는 bare import가 baseUrl 기준으로 풀리지 않는다.
  const tsPaths = await readTsconfigPaths(root);
  const moduleContext: ModuleContext = {
    baseUrlEntries:
      tsPaths?.baseUrlExplicit === true ? await baseUrlEntriesOf(path.join(root, tsPaths.baseUrl)) : new Set(),
    dependencies: await dependencyNamesOf(root),
  };

  const matchers = extractors.map((e) => ({ extractor: e, matches: picomatch(e.files, { dot: false }) }));

  const index: Index = {
    root,
    createdAt: new Date().toISOString(),
    extractors: extractors.map((e) => e.name),
    files: { scanned: 0, skipped: [] },
    styles: [],
    components: [],
  };

  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(path.join(root, file));
    } catch (err) {
      index.files.skipped.push({ file, reason: `read: ${messageOf(err)}` });
      continue;
    }
    if (isNulPlaceholder(bytes)) {
      index.files.skipped.push({ file, reason: NUL_PLACEHOLDER_REASON });
      continue;
    }
    const code = bytes.toString("utf-8");

    // 한 파일의 결과는 모두 성공했을 때만 인덱스에 반영한다(부분 결과가 남지 않게).
    const ctx: ExtractContext = { root, file, code };
    const styles: StyleUsage[] = [];
    let stage = "components";
    try {
      for (const { extractor, matches } of matchers) {
        if (!matches(file)) continue;
        stage = extractor.name;
        if (!extractor.appliesTo(ctx)) continue;
        for (const usage of extractor.extract(ctx)) {
          // WeakMap 키인 원본 객체를 그대로 유지해야 하므로 복제하지 않고 file만 맞춘다.
          usage.file = file;
          styles.push(usage);
        }
      }
      stage = "components";
      const components = JS_FILE.test(file)
        ? extractComponentUsage(file, parseTsx(code, file), tsPaths, moduleContext)
        : [];
      index.styles.push(...styles);
      index.components.push(...components);
      index.files.scanned += 1;
    } catch (err) {
      index.files.skipped.push({ file, reason: `parse(${stage}): ${messageOf(err)}` });
    }
  }
  return index;
}
