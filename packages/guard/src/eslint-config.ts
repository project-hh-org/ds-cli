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
  | { status: "present"; file: string } // 마커 두 쌍이 모두 있음 → 블록만 갱신
  | { status: "needs-ts-parser"; file: string; snippet: string } // .ts/.tsx가 있는데 TS 파서 설정이 없음 → 설정을 고치지 않음
  | { status: "unsupported-shape"; file: string; snippet: string }
  | { status: "legacy"; file: string; snippet: string } // .eslintrc*
  | { status: "not-eslint"; tool: "biome" | "oxlint" }
  | { status: "no-config" };

/** 사람이 붙여 넣을 import + 배열 항목 2줄 */
export function eslintSnippet(): string {
  return `${IMPORT_BLOCK}\n${CONFIG_BLOCK.trim()}`;
}

/** TS 파일 존재 여부와 package.json의 TS 파서 의존성 — 호출자가 파일 시스템에서 모아 넘긴다(planEslintConfig는 순수) */
export interface TsParserContext {
  hasTsFiles: boolean;
  /** 루트 package.json의 dependencies/devDependencies에 typescript-eslint 또는 @typescript-eslint/parser */
  tsParserDep: boolean;
}

const TS_PARSER_TEXT = /typescript-eslint|@typescript-eslint\/parser|tseslint/;

const FLAT_CONFIG =/^eslint\.config\.(?:js|mjs|ts)$/;

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
export function planEslintConfig(_root: string, lint: DetectResult["lint"], text: string | null, ts?: TsParserContext): EslintPlan {
  if (lint.tool === "biome" || lint.tool === "oxlint") return { status: "not-eslint", tool: lint.tool };
  if (lint.tool === "none" || lint.configFile === undefined) return { status: "no-config" };
  const file = lint.configFile;
  const snippet = eslintSnippet();
  if (/^\.eslintrc/.test(file)) return { status: "legacy", file, snippet };
  if (file === "eslint.config.cjs") return { status: "unsupported-shape", file, snippet };
  if (!FLAT_CONFIG.test(file) || text === null) return { status: "no-config" };

  const hasPair = (m: { start: string; end: string }): boolean => text.includes(m.start) && text.includes(m.end);
  // 두 쌍이 모두 있어야 present. 하나만 남았으면 없는 쪽을 AST에서 계산해 끼워 넣는다(남은 블록은 그대로)
  if (hasPair(ESLINT_CONFIG_MARKERS) && hasPair(ESLINT_IMPORT_MARKERS)) return { status: "present", file };

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
  // 플러그인 recommended는 .ts/.tsx까지 lint한다 — TS 파서가 없으면 eslint .가 파싱 오류로 깨지므로 설정을 고치지 않는다
  if (ts !== undefined && ts.hasTsFiles && !ts.tsParserDep && !TS_PARSER_TEXT.test(text)) return { status: "needs-ts-parser", file, snippet };
  return { status: "insert", file, importLine, configLine };
}
