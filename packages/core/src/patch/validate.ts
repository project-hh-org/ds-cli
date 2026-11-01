import { parseCssDeclarations } from "../parse/css-text.js";
import { parseTsx } from "../parse/tsx.js";

export type EditCheck = { ok: true } | { ok: false; reason: string };

const SCRIPT_FILE = /\.(tsx|jsx|ts|js|mjs|cjs|mts|cts)$/i;
const STYLE_FILE = /\.(css|scss)$/i;

function parseErrors(code: string, file: string): number | null {
  try {
    return parseTsx(code, file).errors?.length ?? 0;
  } catch {
    return null;
  }
}

/** 따옴표·주석 밖 `{}`·`()`의 (열림 − 닫힘) */
function balance(text: string, lineComments: boolean): { braces: number; parens: number } {
  let braces = 0;
  let parens = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote || ch === "\n") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close === -1) break;
      i = close + 1;
    } else if (lineComments && ch === "/" && text[i + 1] === "/" && parens === 0) {
      const newline = text.indexOf("\n", i);
      if (newline === -1) break;
      i = newline;
    } else if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "(") parens++;
    else if (ch === ")") parens--;
  }
  return { braces, parens };
}

/**
 * 편집 전후를 다시 읽어 구문이 더 나빠지지 않았는지 본다(의미 검증은 호출자의 재추출 몫).
 * - .tsx/.jsx/.ts/.js/.mjs/.cjs/.mts/.cts: `parseTsx`가 던지면 실패, 아니면 after 오류 수 ≤ before 오류 수
 * - .css/.scss: 선언 수가 같고, 따옴표·주석 밖 `{`·`}`·`(`·`)` 균형이 before와 같아야 함
 * - 그 밖: 검증할 수 없는 파일 형식
 */
export function validateEdit(file: string, before: string, after: string): EditCheck {
  if (SCRIPT_FILE.test(file)) {
    const b = parseErrors(before, file);
    const a = parseErrors(after, file);
    if (a === null) return { ok: false, reason: "편집 뒤 파일을 파싱할 수 없음" };
    if (b !== null && a > b) return { ok: false, reason: `편집 뒤 구문 오류가 늘어남 (${b} → ${a})` };
    return { ok: true };
  }
  if (STYLE_FILE.test(file)) {
    const scss = /\.scss$/i.test(file);
    const beforeDecls = parseCssDeclarations(before, 0, { lineComments: scss }).length;
    const afterDecls = parseCssDeclarations(after, 0, { lineComments: scss }).length;
    if (beforeDecls !== afterDecls) return { ok: false, reason: `선언 수가 달라짐 (${beforeDecls} → ${afterDecls})` };
    const b = balance(before, scss);
    const a = balance(after, scss);
    if (a.braces !== b.braces || a.parens !== b.parens) return { ok: false, reason: "괄호 균형이 달라짐" };
    return { ok: true };
  }
  return { ok: false, reason: "검증할 수 없는 파일 형식" };
}
