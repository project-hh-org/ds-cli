import { parseTsx } from "@dsmith-dev/core";
import type { DetectResult } from "@dsmith-dev/detect";

type Stmt = ReturnType<typeof parseTsx>["program"]["body"][number];
/** export default의 식 */
type Node = Extract<Stmt, { type: "ExportDefaultDeclaration" }>["declaration"];
type Callee = Extract<Node, { type: "CallExpression" }>["callee"];

export const ESLINT_IMPORT_MARKERS = { start: "/* dsmith:import:start */", end: "/* dsmith:import:end */" } as const;
export const ESLINT_CONFIG_MARKERS = { start: "/* dsmith:start */", end: "/* dsmith:end */" } as const;

export const IMPORT_BLOCK = 'import dsmith from "@dsmith-dev/eslint-plugin";';
export const CONFIG_BLOCK = "  dsmith.configs.recommended,";

export type EslintPlan =
  | { status: "insert"; file: string; importLine: number; configLine: number } // 0-based insertAt
  | { status: "present"; file: string } // 마커가 이미 있음 → 블록만 갱신
  | { status: "unsupported-shape"; file: string; snippet: string }
  | { status: "legacy"; file: string; snippet: string } // .eslintrc*
  | { status: "not-eslint"; tool: "biome" | "oxlint" }
  | { status: "no-config" };

/** 사람이 붙여 넣을 import + 배열 항목 2줄 */
export function eslintSnippet(): string {
  return `${IMPORT_BLOCK}\n${CONFIG_BLOCK.trim()}`;
}

const FLAT_CONFIG = /^eslint\.config\.(?:js|mjs|ts)$/;

/** `(`·`[`가 그 줄의 마지막 비공백 문자인 줄(1-based). 아니면 null */
function openerLine(lines: string[], text: string, offset: number, opener: "(" | "["): number | null {
  if (text[offset] !== opener) return null;
  const upto = text.slice(0, offset).split("\n").length; // 1-based 줄
  const line = lines[upto - 1] ?? "";
  const col = offset - (text.lastIndexOf("\n", offset - 1) + 1);
  const rest = line.slice(col + 1).replace(/\r$/, "");
  return rest.trim() === "" ? upto : null;
}

function calleeIsConfigFactory(callee: Callee): "defineConfig" | "config" | null {
  if (callee.type === "Identifier" && callee.name === "defineConfig") return "defineConfig";
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "config") return "config";
  return null;
}

/** export default 식에서 배열 항목을 넣을 줄(1-based, 여는 괄호가 있는 줄). 못 찾으면 null */
function configOpenerLine(decl: Node, text: string, lines: string[]): number | null {
  if (decl.type === "ArrayExpression") return decl.start == null ? null : openerLine(lines, text, decl.start, "[");
  if (decl.type !== "CallExpression" || decl.callee.end == null) return null;
  const kind = calleeIsConfigFactory(decl.callee);
  if (kind === null) return null;
  const first = decl.arguments[0];
  if (kind === "defineConfig" && first?.type === "ArrayExpression" && first.start != null) {
    return openerLine(lines, text, first.start, "[");
  }
  // tseslint.config( … ) — 호출 괄호를 callee 뒤에서 찾는다(타입 인자가 없을 때만)
  let i = decl.callee.end;
  while (i < text.length && /\s/.test(text[i] ?? "")) i += 1;
  return openerLine(lines, text, i, "(");
}

/**
 * detect.lint 기준으로 ESLint 설정에 어떻게 끼워 넣을지 정한다. 순수 — 파일은 읽지 않고 text를 받는다.
 * flat(eslint.config.{js,mjs,ts})이면 parseTsx로 마지막 최상위 import 뒤(importLine)와
 * `export default [` / `defineConfig([` / `tseslint.config(`의 여는 괄호 줄 뒤(configLine)를 정한다.
 */
export function planEslintConfig(_root: string, lint: DetectResult["lint"], text: string | null): EslintPlan {
  if (lint.tool === "biome" || lint.tool === "oxlint") return { status: "not-eslint", tool: lint.tool };
  if (lint.tool === "none" || lint.configFile === undefined) return { status: "no-config" };
  const file = lint.configFile;
  const snippet = eslintSnippet();
  if (/^\.eslintrc/.test(file)) return { status: "legacy", file, snippet };
  if (file === "eslint.config.cjs") return { status: "unsupported-shape", file, snippet };
  if (!FLAT_CONFIG.test(file) || text === null) return { status: "no-config" };

  if (text.includes(ESLINT_CONFIG_MARKERS.start) || text.includes(ESLINT_IMPORT_MARKERS.start)) return { status: "present", file };

  const unsupported: EslintPlan = { status: "unsupported-shape", file, snippet };
  let ast;
  try {
    ast = parseTsx(text, file);
  } catch {
    return unsupported;
  }
  if ((ast.errors ?? []).length > 0) return unsupported;

  const lines = text.split("\n");
  let importLine = 0;
  let exportDefault: Node | null = null;
  for (const node of ast.program.body) {
    if (node.type === "ImportDeclaration" && node.loc != null) importLine = Math.max(importLine, node.loc.end.line);
    if (node.type === "ExportDefaultDeclaration") exportDefault = node.declaration;
  }
  if (exportDefault === null) return unsupported;
  const configLine = configOpenerLine(exportDefault, text, lines);
  if (configLine === null || importLine >= configLine) return unsupported;
  return { status: "insert", file, importLine, configLine };
}
