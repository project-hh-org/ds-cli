import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import picomatch from "picomatch";
import { JS_FILES } from "@dsmith/extractor-api";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith/extractor-api";
import type { ComponentUsage } from "../model/component-usage.js";
import { parseTsx } from "../parse/tsx.js";
import { extractComponentUsage } from "./component-usage.js";
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

  // 컴포넌트 import 해석에 쓸 tsconfig paths는 레포마다 한 번만 읽는다.
  const tsPaths = await readTsconfigPaths(root);

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
    let code: string;
    try {
      code = await fs.readFile(path.join(root, file), "utf-8");
    } catch (err) {
      index.files.skipped.push({ file, reason: `read: ${messageOf(err)}` });
      continue;
    }

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
      const components = JS_FILE.test(file) ? extractComponentUsage(file, parseTsx(code, file), tsPaths) : [];
      index.styles.push(...styles);
      index.components.push(...components);
      index.files.scanned += 1;
    } catch (err) {
      index.files.skipped.push({ file, reason: `parse(${stage}): ${messageOf(err)}` });
    }
  }
  return index;
}
