/**
 * Tailwind 프리셋(v3 `presets` / v4 `@theme inline`) 방출·키 파싱·연결 판정.
 *
 * 외부 규약 근거: Plan 4a 부록 C.2 (2026-11-01, 로컬 빌드 프로브 — tailwindcss 3.4.19, 4.3.3).
 * - v3: 프리셋의 평탄 키 `theme.extend.{colors,spacing,borderRadius,fontSize}`에 `"ds-<key>": "var(--…)"`를 두면
 *   `bg-ds-blue-400`·`p-ds-2`·`rounded-ds-sm`·`text-ds-xs`가 생성된다. TS config가 TS 프리셋을 import하는 것도 동작한다.
 *   확장자 없는 import는 같은 디렉터리에 `.cjs`와 `.ts`가 함께 있으면 `.cjs`를 먼저 집는다(init이 옛 파일을 경고).
 * - v4: 진입 CSS에서 `@import "<경로>/tailwind.theme.css"`, 파일은 `@theme inline { --color-ds-…: var(--…); }`
 *   (네임스페이스 `--color-*`·`--spacing-*`·`--radius-*`·`--text-*`).
 * - 키는 `ds-` 접두 — 접두 없는 `bg-blue-400`·`p-2`는 Tailwind 기본 테마와 이름이 같아 기본값을 조용히 덮는다.
 * - 값은 `tokens.css` 변수 참조(`var(--color-blue-400)`)라 `tokens.css`가 전역에 로드돼 있어야 한다.
 */
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { TAILWIND_PRESET_PREFIX, type TailwindPreset } from "@dsmith-dev/extractor-api";
import { DEFAULT_EXCLUDE } from "../index/indexer.js";
import type { DraftGroup, TokenDraft } from "./draft.js";
import { GENERATED_NOTICE } from "./emit.js";

export type PresetFormat = "v3-ts" | "v3-cjs" | "v4-css";

const FILE_NAMES = {
  "v3-ts": "tailwind.preset.ts",
  "v3-cjs": "tailwind.preset.cjs",
  "v4-css": "tailwind.theme.css",
} as const;

/** 프리셋 파일 이름 */
export function presetFileName<F extends PresetFormat>(format: F): (typeof FILE_NAMES)[F] {
  return FILE_NAMES[format];
}

/** 루트에서 찾는 tailwind.config 확장자(우선순위 순) */
const CONFIG_EXTENSIONS = ["ts", "mts", "cts", "js", "mjs", "cjs"] as const;
const TS_CONFIG = /\.(?:ts|mts|cts)$/;

/** v4 → "v4-css". v3: 루트 tailwind.config 확장자가 .ts/.mts/.cts면 "v3-ts", 그 밖(없음 포함) "v3-cjs" */
export function presetFormatFor(version: 3 | 4, configFile: string | null): PresetFormat {
  if (version === 4) return "v4-css";
  return configFile !== null && TS_CONFIG.test(configFile) ? "v3-ts" : "v3-cjs";
}

/** 루트의 tailwind.config.{ts,mts,cts,js,mjs,cjs} 중 있는 첫 파일 이름. 없으면 null. */
export async function findTailwindConfig(root: string): Promise<string | null> {
  for (const ext of CONFIG_EXTENSIONS) {
    const name = `tailwind.config.${ext}`;
    try {
      if ((await fs.stat(path.join(root, name))).isFile()) return name;
    } catch {
      // 없음 — 다음 확장자
    }
  }
  return null;
}

const SECTIONS: { group: DraftGroup; v3: string; ns: string }[] = [
  { group: "color", v3: "colors", ns: "color" },
  { group: "space", v3: "spacing", ns: "spacing" },
  { group: "radius", v3: "borderRadius", ns: "radius" },
  { group: "text", v3: "fontSize", ns: "text" },
];

const classKey = (key: string): string => `${TAILWIND_PRESET_PREFIX}-${key}`;

/** 프리셋 안내 주석의 기본 산출 디렉터리 */
const DEFAULT_OUT_DIR = "design-system";

/** draft 순서(그룹 color → space → radius → text, 빈 그룹 생략). 키 = `ds-<key>`, 값 = `var(--<name>)` */
export function emitTailwindPreset(draft: TokenDraft, format: PresetFormat, opts: { outDir?: string } = {}): string {
  const dir = opts.outDir ?? DEFAULT_OUT_DIR;
  const base = dir === "." ? "." : `./${dir}`;
  if (format === "v4-css") {
    const lines: string[] = [];
    for (const { group, ns } of SECTIONS) {
      for (const t of draft.tokens.filter((x) => x.group === group)) {
        lines.push(`  --${ns}-${classKey(t.key)}: var(--${t.name});`);
      }
    }
    return (
      `/* ${GENERATED_NOTICE} */\n` +
      `/* Tailwind 진입 CSS에서 @import "tailwindcss"; 다음 줄에 @import "${base}/tailwind.theme.css"; 를 추가하세요 */\n` +
      `@theme inline {\n${lines.join("\n")}\n}\n`
    );
  }

  const blocks: string[] = [];
  for (const { group, v3 } of SECTIONS) {
    const entries = draft.tokens.filter((x) => x.group === group);
    if (entries.length === 0) continue;
    const lines = entries.map((t) => `        ${JSON.stringify(classKey(t.key))}: ${JSON.stringify(`var(--${t.name})`)},`);
    blocks.push(`      ${v3}: {\n${lines.join("\n")}\n      },`);
  }
  const theme = `{\n  theme: {\n    extend: {${blocks.length === 0 ? "" : `\n${blocks.join("\n")}\n    `}},\n  },\n}`;
  if (format === "v3-ts") {
    return (
      `// ${GENERATED_NOTICE}\n` +
      `// tailwind.config의 presets에 추가하세요: import dsPreset from "${base}/tailwind.preset"; … presets: [dsPreset]\n` +
      `export default ${theme};\n`
    );
  }
  return (
    `// ${GENERATED_NOTICE}\n` +
    `// tailwind.config의 presets에 추가하세요: const dsPreset = require("${base}/tailwind.preset"); … presets: [dsPreset]\n` +
    `module.exports = ${theme};\n`
  );
}

const V3_LINE = /^\s*"([^"]+)"\s*:\s*"var\((--[A-Za-z0-9_-]+)\)"\s*,?\s*$/;
const V4_LINE = /^\s*--(?:color|spacing|radius|text)-([A-Za-z0-9_-]+)\s*:\s*var\((--[A-Za-z0-9_-]+)\)\s*;/;

/**
 * 생성 파일(사람이 고친 것 포함)에서 CSS 변수 이름 → 클래스 키.
 * v3: `"<key>": "var(<--name>)"` 줄, v4: `--<ns>-<key>: var(<--name>);`(ns ∈ color|spacing|radius|text).
 */
export function parsePresetKeys(text: string, format: PresetFormat): Record<string, string> {
  const out: Record<string, string> = {};
  const re = format === "v4-css" ? V4_LINE : V3_LINE;
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (m === null) continue;
    const key = m[1];
    const cssVar = m[2];
    if (key !== undefined && cssVar !== undefined) out[cssVar] = key;
  }
  return out;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 루트의 모든 CSS 파일(root 상대 POSIX, 기본 제외 적용, 정렬). v4 연결 판정의 입력. */
export async function listCssFiles(root: string): Promise<string[]> {
  const files = await fg(["**/*.css"], { cwd: root, ignore: [...DEFAULT_EXCLUDE], dot: false });
  return files.map((f) => f.split(path.sep).join("/")).sort();
}

async function readText(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, "utf-8");
  } catch {
    return null;
  }
}

/** 블록 주석과 줄 전체 `//` 주석을 뺀다(생성 파일의 안내 주석이 연결로 오인되지 않게). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

async function linkedV3(root: string, initDir: string): Promise<boolean> {
  const dir = initDir === "." ? "" : `${escapeRe(initDir)}/`;
  const importRe = new RegExp(`["'](?:\\./)?${dir}tailwind\\.preset(?:\\.(?:ts|cjs|js|mjs|mts|cts))?["']`);
  for (const ext of CONFIG_EXTENSIONS) {
    const raw = await readText(path.join(root, `tailwind.config.${ext}`));
    const text = raw === null ? null : stripComments(raw);
    if (text !== null && /\bpresets\b/.test(text) && importRe.test(text)) return true;
  }
  return false;
}

async function linkedV4(root: string, cssFiles: string[]): Promise<boolean> {
  for (const css of cssFiles) {
    const raw = await readText(path.join(root, css));
    if (raw !== null && /@import[^\n]*tailwind\.theme\.css/.test(stripComments(raw))) return true;
  }
  return false;
}

/**
 * initDir 아래 세 이름 중 있는 파일 하나(v4-css > v3-ts > v3-cjs 순, tailwindVersion이 있으면 그 버전 것만)를 읽어 TailwindPreset으로.
 * linked — v3: 루트 tailwind.config.{ts,mts,cts,js,mjs,cjs} 중 하나의 텍스트에 `presets`가 있고 `<initDir>/tailwind.preset`(확장자 생략 허용, ./ 접두 허용)이 있음.
 *          v4: cssFiles(root 상대) 중 하나에 `@import`와 `tailwind.theme.css` 경로 끝이 같은 줄에 있음.
 * 프리셋 파일이 없으면 null.
 */
export async function readTailwindPreset(
  root: string,
  opts: { initDir: string | null; tailwindVersion?: 3 | 4; cssFiles: string[] },
): Promise<TailwindPreset | null> {
  const { initDir, tailwindVersion } = opts;
  if (initDir === null) return null;
  const formats: PresetFormat[] = (["v4-css", "v3-ts", "v3-cjs"] as const).filter(
    (f) => tailwindVersion === undefined || (tailwindVersion === 4) === (f === "v4-css"),
  );
  for (const format of formats) {
    const file = initDir === "." ? presetFileName(format) : `${initDir}/${presetFileName(format)}`;
    const text = await readText(path.join(root, file));
    if (text === null) continue;
    const version = format === "v4-css" ? 4 : 3;
    const linked = version === 4 ? await linkedV4(root, opts.cssFiles) : await linkedV3(root, initDir);
    return { version, file, linked, keys: parsePresetKeys(text, format) };
  }
  return null;
}
