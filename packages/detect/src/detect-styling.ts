import fs from "node:fs/promises";
import path from "node:path";
import type { Index } from "@dsmith/core";
import type { ExtractorMeta } from "@dsmith/extractor-api";
import { isMonorepoRoot, listFiles, type SourceFile } from "./fs-utils.js";

export type StylingMethodName = "tailwind" | "inline-style" | "css" | "css-modules" | "styled" | "emotion" | "mui-sx";

export interface StylingDetection {
  methods: { name: StylingMethodName; evidence: string[]; share: number }[];
}

const TAILWIND_CONFIGS = "**/tailwind.config.*";
const TAILWIND_CSS_IMPORT = /@import\s+(?:url\()?["']tailwindcss(?:\/[^"']*)?["']/;
/** Tailwind v3 CSS 지시어 */
const TAILWIND_DIRECTIVE = /@tailwind\s+(?:base|components|utilities)\b/;
/** 루트가 모노레포 루트일 때 감지된 방식의 근거에 붙인다. CLI가 `--root apps/<app>` 힌트를 낸다. */
export const MONOREPO_ROOT_EVIDENCE = "monorepo-root";
/** 감지된 방식이 없을 때 inline-style을 대신 켜는 근거. */
const FALLBACK_EVIDENCE = "fallback";
const EVIDENCE_FILE_CAP = 3;

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

async function tailwindEvidence(root: string, deps: string[]): Promise<string[]> {
  const evidence: string[] = [];
  if (deps.includes("tailwindcss")) evidence.push("package.json: tailwindcss");
  evidence.push(...(await listFiles(root, [TAILWIND_CONFIGS])));
  for (const css of await listFiles(root, ["**/*.css"])) {
    let content: string;
    try {
      content = await fs.readFile(path.join(root, css), "utf-8");
    } catch {
      continue;
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

export interface StylingInput {
  deps: string[];
  sources: SourceFile[];
}

/** 파일·의존성 근거로 스타일링 방식을 감지한다. Extractor 해석(폴백)·index 비율·모노레포 표시는 호출자가 이어서 적용한다. */
export async function detectStyling(root: string, input: StylingInput): Promise<StylingDetection> {
  const { deps, sources } = input;
  const methods: StylingDetection["methods"] = [];

  const twEvidence = await tailwindEvidence(root, deps);
  if (twEvidence.length > 0) {
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
  const cssFiles = (await listFiles(root, ["**/*.{css,scss}"])).filter((f) => !path.posix.basename(f).includes(".module."));
  if (cssFiles.length > 0) {
    methods.push({ name: "css", evidence: cap(cssFiles, (f) => f), share: 0 });
  }

  const moduleFiles = await listFiles(root, ["**/*.module.{css,scss}"]);
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

  return { methods };
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
