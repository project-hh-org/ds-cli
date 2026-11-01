import fs from "node:fs/promises";
import path from "node:path";
import type { Index } from "@dsmith-dev/core";
import type { ExtractorMeta, ExtractorSignals } from "@dsmith-dev/extractor-api";
import { isMonorepoRoot, listFiles, loadFiles, type SourceFile } from "./fs-utils.js";

/** detect가 직접 감지하는 방식 이름. 그 밖의 이름은 Extractor가 선언한 `signals`로 감지된다. */
export type StylingMethodName = "tailwind" | "inline-style" | "css" | "css-modules" | "styled" | "emotion" | "mui-sx";

const BUILTIN_METHODS: ReadonlySet<string> = new Set<StylingMethodName>([
  "tailwind",
  "inline-style",
  "css",
  "css-modules",
  "styled",
  "emotion",
  "mui-sx",
]);

export interface StylingDetection {
  /** 내장 방식(`StylingMethodName`) 다음에 Extractor `signals`로 감지한 방식이 온다. */
  methods: { name: StylingMethodName | (string & {}); evidence: string[]; share: number }[];
  /**
   * tailwind가 감지됐을 때만. package.json tailwindcss 범위의 첫 정수(^3.4.0 → 3, ~4.1 → 4; 숫자 없음·4 초과·3 미만 → 다음 근거)
   * → `@tailwindcss/postcss`·`@tailwindcss/vite` 의존성 → `@import "tailwindcss"`(bare·v4 서브패스 theme/preflight/utilities.css) 근거 → 4 → `@tailwind` 지시어·`@import "tailwindcss/(base|components|utilities)"`(.css 없음)·tailwind.config.* → 3 → 없음.
   */
  tailwindVersion?: 3 | 4;
}

const TAILWIND_CONFIGS = "**/tailwind.config.*";
/** v3 전용 서브패스(`.css` 없음): `tailwindcss/base`·`/components`·`/utilities`. 4 근거가 아니다. */
const TAILWIND_V3_IMPORT = /@import\s+(?:url\()?["'](tailwindcss\/(?:base|components|utilities))["']/;
/** 그 밖의 `@import "tailwindcss"` — bare와 v4 서브패스(`tailwindcss/theme.css`·`preflight.css`·`utilities.css`) */
const TAILWIND_CSS_IMPORT = /@import\s+(?:url\()?["']tailwindcss(?:\/[^"']*)?["']/;
/** Tailwind v3 CSS 지시어 */
const TAILWIND_DIRECTIVE = /@tailwind\s+(?:base|components|utilities)\b/;
/** 루트가 모노레포 루트일 때 감지된 방식의 근거에 붙인다. CLI가 `--root apps/<app>` 힌트를 낸다. */
export const MONOREPO_ROOT_EVIDENCE = "monorepo-root";
/** 감지된 방식이 없을 때 inline-style을 대신 켜는 근거. */
const FALLBACK_EVIDENCE = "fallback";
const EVIDENCE_FILE_CAP = 3;
/** signals.code를 검사할 스타일시트. */
const STYLESHEETS = ["**/*.{css,scss}"];

const INLINE_STYLE = /style=\{\{/;
const CSS_MODULE_IMPORT = /\.module\.(?:css|scss)["']/;
const STYLED = /\bstyled\.|\bstyled\(/;
const EMOTION = /\bcss`|@emotion\//;
const CLASS_NAME = /className=/;
const SX_PROP = /sx=\{\{/;
const MUI_SX_DEPS = ["@mui/material", "@mui/joy"];

function cap(files: string[], label: (f: string) => string): string[] {
  return files.slice(0, EVIDENCE_FILE_CAP).map(label);
}

async function tailwindEvidence(root: string, deps: string[], exclude: string[]): Promise<string[]> {
  const evidence: string[] = [];
  if (deps.includes("tailwindcss")) evidence.push("package.json: tailwindcss");
  evidence.push(...(await listFiles(root, [TAILWIND_CONFIGS], exclude)));
  for (const css of await listFiles(root, ["**/*.css"], exclude)) {
    let content: string;
    try {
      content = await fs.readFile(path.join(root, css), "utf-8");
    } catch {
      continue;
    }
    const v3Import = TAILWIND_V3_IMPORT.exec(content);
    if (v3Import !== null) {
      evidence.push(`@import "${v3Import[1]}" in ${css}`);
      break;
    }
    if (TAILWIND_CSS_IMPORT.test(content)) {
      evidence.push(`@import "tailwindcss" in ${css}`);
      break;
    }
    if (TAILWIND_DIRECTIVE.test(content)) {
      evidence.push(`@tailwind directive in ${css}`);
      break;
    }
  }
  return evidence;
}

/** 마커를 포함한 소스 파일의 비율(스캔한 파일 수 대비). 스캔 파일이 없으면 0. */
function fileShare(sources: SourceFile[], match: (s: SourceFile) => boolean): number {
  if (sources.length === 0) return 0;
  return sources.filter(match).length / sources.length;
}

function indexShare(index: Index, extractor: string): number {
  if (index.styles.length === 0) return 0;
  return index.styles.filter((u) => u.extractor === extractor).length / index.styles.length;
}

/** 범위 문자열의 첫 정수가 3 또는 4면 그 값. 숫자가 없거나("latest", "*") 범위 밖이면 null. */
function majorOfRange(range: string): 3 | 4 | null {
  const m = /\d+/.exec(range);
  if (m === null) return null;
  const n = Number(m[0]);
  return n === 3 || n === 4 ? n : null;
}

function tailwindVersionOf(deps: string[], ranges: Record<string, string>, evidence: string[]): 3 | 4 | undefined {
  const range = ranges.tailwindcss;
  const fromRange = range === undefined ? null : majorOfRange(range);
  if (fromRange !== null) return fromRange;
  if (deps.includes("@tailwindcss/postcss") || deps.includes("@tailwindcss/vite")) return 4;
  if (evidence.some((e) => e.startsWith('@import "tailwindcss"'))) return 4;
  if (evidence.some((e) => e.startsWith("@tailwind directive") || e.startsWith('@import "tailwindcss/') || /(?:^|\/)tailwind\.config\./.test(e))) return 3;
  return undefined;
}

export interface StylingInput {
  /** 의존성 이름 → 버전 범위(Tailwind 주 버전 판정용). 없으면 범위 근거를 건너뛴다. */
  ranges?: Record<string, string>;
  deps: string[];
  sources: SourceFile[];
  /** 기본 제외에 더할 glob. 파일 목록을 새로 훑을 때 적용한다(`sources`는 이미 적용된 상태로 받는다). */
  exclude?: string[];
}

/** 파일·의존성 근거로 스타일링 방식을 감지한다. Extractor 해석(폴백)·index 비율·모노레포 표시는 호출자가 이어서 적용한다. */
export async function detectStyling(root: string, input: StylingInput): Promise<StylingDetection> {
  const { deps, sources, exclude = [], ranges = {} } = input;
  const methods: StylingDetection["methods"] = [];
  let tailwindVersion: 3 | 4 | undefined;

  const twEvidence = await tailwindEvidence(root, deps, exclude);
  if (twEvidence.length > 0) {
    tailwindVersion = tailwindVersionOf(deps, ranges, twEvidence);
    const hasTailwindDep = deps.includes("tailwindcss");
    methods.push({
      name: "tailwind",
      evidence: twEvidence,
      share: fileShare(sources, (s) => hasTailwindDep && CLASS_NAME.test(s.content)),
    });
  }

  const inlineFiles = sources.filter((s) => INLINE_STYLE.test(s.content)).map((s) => s.file);
  if (inlineFiles.length > 0) {
    methods.push({
      name: "inline-style",
      evidence: cap(inlineFiles, (f) => `style={{ in ${f}`),
      share: fileShare(sources, (s) => INLINE_STYLE.test(s.content)),
    });
  }

  // 일반 스타일시트. 파일 이름에 `.module.`이 들어가면 css-modules 쪽이다.
  const cssFiles = (await listFiles(root, ["**/*.{css,scss}"], exclude)).filter(
    (f) => !path.posix.basename(f).includes(".module."),
  );
  if (cssFiles.length > 0) {
    methods.push({ name: "css", evidence: cap(cssFiles, (f) => f), share: 0 });
  }

  const moduleFiles = await listFiles(root, ["**/*.module.{css,scss}"], exclude);
  if (moduleFiles.length > 0) {
    methods.push({
      name: "css-modules",
      evidence: cap(moduleFiles, (f) => f),
      share: fileShare(sources, (s) => CSS_MODULE_IMPORT.test(s.content)),
    });
  }

  if (deps.includes("styled-components")) {
    methods.push({
      name: "styled",
      evidence: ["package.json: styled-components"],
      share: fileShare(sources, (s) => STYLED.test(s.content)),
    });
  }

  const emotionDeps = ["@emotion/react", "@emotion/styled", "@emotion/css"].filter((d) => deps.includes(d));
  if (emotionDeps.length > 0) {
    methods.push({
      name: "emotion",
      evidence: emotionDeps.map((d) => `package.json: ${d}`),
      share: fileShare(sources, (s) => EMOTION.test(s.content)),
    });
  }

  // MUI sx prop: 의존성만으로는 부족하고, sx={{ 를 쓰는 소스가 있어야 한다.
  const muiDeps = MUI_SX_DEPS.filter((d) => deps.includes(d));
  const sxFiles = muiDeps.length > 0 ? sources.filter((s) => SX_PROP.test(s.content)).map((s) => s.file) : [];
  if (sxFiles.length > 0) {
    methods.push({
      name: "mui-sx",
      evidence: [...muiDeps.map((d) => `package.json: ${d}`), ...cap(sxFiles, (f) => `sx={{ in ${f}`)],
      share: fileShare(sources, (s) => SX_PROP.test(s.content)),
    });
  }

  return tailwindVersion === undefined ? { methods } : { methods, tailwindVersion };
}

/**
 * `available` 메타가 선언한 `signals`로 방식을 감지한다. 신호 하나라도 맞으면 방식 하나다.
 * - dependencies: `package.json: <이름>` 근거, share 0.
 * - files: glob 목록(`!` 부정 포함)의 첫 매칭 파일이 근거, share 0.
 * - code: JS/TS 소스(`sources`)와 CSS/SCSS 파일 내용에 정규식을 검사. 근거는 최대 3개, share = 매칭 파일 / 검사한 파일.
 * 내장 방식 이름(`StylingMethodName`)은 detectStyling이 판정하므로 이번 판에서는 signals를 평가하지 않는다
 * (내장 블록을 signals로 옮기는 것은 다음 계획). 같은 이름의 메타가 여럿이면 처음 것만 쓴다.
 */
export async function detectSignalMethods(
  root: string,
  input: StylingInput,
  available: ExtractorMeta[] | undefined,
): Promise<StylingDetection["methods"]> {
  const { deps, sources, exclude = [] } = input;
  const candidates: { name: string; signals: ExtractorSignals }[] = [];
  for (const { name, signals } of available ?? []) {
    if (signals === undefined || BUILTIN_METHODS.has(name) || candidates.some((c) => c.name === name)) continue;
    candidates.push({ name, signals });
  }
  if (candidates.length === 0) return [];

  // code 신호가 있을 때만 스타일시트를 읽는다. JS/TS 소스는 detect가 이미 읽은 것을 쓴다.
  const codeSamples = candidates.some((c) => c.signals.code !== undefined)
    ? [...sources, ...(await loadFiles(root, STYLESHEETS, exclude))]
    : sources;

  const methods: StylingDetection["methods"] = [];
  for (const { name, signals } of candidates) {
    const evidence: string[] = [];
    let share = 0;

    for (const dep of signals.dependencies ?? []) {
      if (deps.includes(dep)) evidence.push(`package.json: ${dep}`);
    }
    if (signals.files !== undefined) {
      // glob 목록을 한 번에 넘겨 `!` 부정 패턴이 나머지 패턴에 적용되게 한다.
      const first = (await listFiles(root, signals.files, exclude))[0];
      if (first !== undefined) evidence.push(first);
    }
    if (signals.code !== undefined) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(signals.code);
      } catch (err) {
        throw new Error(`Extractor "${name}"의 signals.code:${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
      const matched = codeSamples.filter((s) => pattern.test(s.content)).map((s) => s.file);
      evidence.push(...cap(matched, (f) => `/${signals.code}/ in ${f}`));
      if (codeSamples.length > 0) share = matched.length / codeSamples.length;
    }

    if (evidence.length > 0) methods.push({ name, evidence, share });
  }
  return methods;
}

/** 내장 방식 뒤에 signals 방식을 붙인다. 이름이 이미 있으면 내장 방식을 남긴다. */
export function mergeMethods(styling: StylingDetection, extra: StylingDetection["methods"]): void {
  const names = new Set(styling.methods.map((m) => m.name));
  for (const m of extra) {
    if (names.has(m.name)) continue;
    names.add(m.name);
    styling.methods.push(m);
  }
}

/** 예전 이름 → 현재 Extractor 이름. MUI sx 방식은 한때 `"sx"`로 보고됐다. */
const LEGACY_EXTRACTOR_NAMES: Record<string, string> = { sx: "mui-sx" };

/** 사용자가 쓴 Extractor 이름 목록(overrides.activeExtractors)의 예전 이름을 현재 이름으로 바꾸고 중복을 뺀다. */
export function normalizeExtractorNames(names: string[]): string[] {
  return [...new Set(names.map((n) => (Object.hasOwn(LEGACY_EXTRACTOR_NAMES, n) ? LEGACY_EXTRACTOR_NAMES[n]! : n)))];
}

/** 이번 실행에서 쓴 Extractor(`index.extractors`)가 있는 방식의 share를 index의 usage 비율로 덮어쓴다. 나머지는 파일 스캔 기반 share를 유지한다. */
export function applyIndexShares(styling: StylingDetection, index: Index): void {
  for (const m of styling.methods) {
    if (index.extractors.includes(m.name)) m.share = indexShare(index, m.name);
  }
}

/** 루트가 모노레포 루트면 모든 방식의 근거에 `monorepo-root`를 붙인다. */
export async function markMonorepoRoot(root: string, styling: StylingDetection): Promise<void> {
  if (!(await isMonorepoRoot(root))) return;
  for (const m of styling.methods) m.evidence.push(MONOREPO_ROOT_EVIDENCE);
}

/**
 * 감지된 방식 중 사용 가능한 Extractor가 있는 것의 이름을 방식 순서대로 돌려준다.
 * - `available`이 없으면 Extractor 해석 없이 감지된 방식 이름을 그대로 돌려준다(폴백 없음).
 * - 교집합이 비고 `available`에 `inline-style`이 있으면 `["inline-style"]`로 대체하고,
 *   `styling.methods`의 inline-style 항목에 `fallback` 근거를 더한다(없으면 만든다).
 */
export function activeExtractorsOf(styling: StylingDetection, available: ExtractorMeta[] | undefined): string[] {
  if (available === undefined) return styling.methods.map((m) => m.name);

  const availableNames = new Set(available.map((a) => a.name));
  const active = styling.methods.map((m) => m.name).filter((n) => availableNames.has(n));
  if (active.length > 0 || !availableNames.has("inline-style")) return active;

  const existing = styling.methods.find((m) => m.name === "inline-style");
  if (existing) existing.evidence.push(FALLBACK_EVIDENCE);
  else styling.methods.push({ name: "inline-style", evidence: [FALLBACK_EVIDENCE], share: 0 });
  return ["inline-style"];
}
