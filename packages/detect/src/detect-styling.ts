import fs from "node:fs/promises";
import path from "node:path";
import type { Index } from "@ds-cli/core";
import { isMonorepoRoot, listFiles, type SourceFile } from "./fs-utils.js";

export type StylingMethodName = "tailwind" | "inline-style" | "css-modules" | "styled" | "emotion";

export interface StylingDetection {
  methods: { name: StylingMethodName; evidence: string[]; share: number }[];
}

/** 구현된 Extractor 이름. CLI 레지스트리 키, Extractor.name과 같아야 한다. */
const IMPLEMENTED_EXTRACTORS: StylingMethodName[] = ["tailwind", "inline-style"];

const TAILWIND_CONFIGS = "**/tailwind.config.*";
const TAILWIND_CSS_IMPORT = /@import\s+(?:url\()?["']tailwindcss(?:\/[^"']*)?["']/;
/** Tailwind v3 CSS 지시어 */
const TAILWIND_DIRECTIVE = /@tailwind\s+(?:base|components|utilities)\b/;
/** 루트가 모노레포 루트일 때 감지된 방식의 근거에 붙인다. CLI가 `--root apps/<app>` 힌트를 낸다. */
export const MONOREPO_ROOT_EVIDENCE = "monorepo-root";
const EVIDENCE_FILE_CAP = 3;

const INLINE_STYLE = /style=\{\{/;
const CSS_MODULE_IMPORT = /\.module\.(?:css|scss)["']/;
const STYLED = /\bstyled\.|\bstyled\(/;
const EMOTION = /\bcss`|@emotion\//;
const CLASS_NAME = /className=/;

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
  index?: Index | undefined;
}

export async function detectStyling(root: string, input: StylingInput): Promise<StylingDetection> {
  const { deps, sources, index } = input;
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

  const emotionDeps = ["@emotion/react", "@emotion/styled"].filter((d) => deps.includes(d));
  if (emotionDeps.length > 0) {
    methods.push({
      name: "emotion",
      evidence: emotionDeps.map((d) => `package.json: ${d}`),
      share: fileShare(sources, (s) => EMOTION.test(s.content)),
    });
  }

  // Extractor가 있는 방식은 index의 usage 비율로 덮어쓴다. 나머지는 파일 스캔 기반 share를 유지한다.
  if (index) {
    for (const m of methods) {
      if (IMPLEMENTED_EXTRACTORS.includes(m.name)) m.share = indexShare(index, m.name);
    }
  }

  // 구현된 Extractor에 대응하는 방식이 하나도 없으면(근거 없음, 또는 css-modules·styled·emotion뿐)
  // 가장 값싼 inline-style Extractor로 대체한다. activeExtractors가 비는 일은 없다.
  if (!methods.some((m) => IMPLEMENTED_EXTRACTORS.includes(m.name))) {
    methods.push({
      name: "inline-style",
      evidence: ["fallback"],
      share: index ? indexShare(index, "inline-style") : 0,
    });
  }

  if (await isMonorepoRoot(root)) {
    for (const m of methods) m.evidence.push(MONOREPO_ROOT_EVIDENCE);
  }

  return { methods };
}

/** 감지된 방식 중 Extractor가 구현된 것만 돌려준다. */
export function activeExtractorsOf(styling: StylingDetection): string[] {
  return IMPLEMENTED_EXTRACTORS.filter((n) => styling.methods.some((m) => m.name === n));
}
