import {
  cssPropertyToStyleProperty,
  isColorProperty,
  isLengthProperty,
  normalizeColor,
  normalizeLength,
  parseCssDeclarations,
  splitShorthandColor,
} from "@dsmith/core";
import type { ExtractContext, Extractor, StyleProperty, StyleUsage } from "@dsmith/extractor-api";
import { registerPatchTarget, write } from "./write.js";

export const EXTRACTOR_NAME = "css";

type Normalized = StyleUsage["normalized"];
const UNKNOWN: Normalized = { kind: "unknown" };

/** 공백으로 나뉜 토큰 하나가 `var(--…)`(CSS 변수) 또는 `$name`(scss 변수)이면 토큰 참조다. */
const TOKEN_REF = /^(?:var\(\s*--.*\)|\$[\w-]+)$/is;
const IMPORTANT = /\s*!\s*important\s*$/i;

/** 각 줄의 시작 오프셋. */
function lineStartsOf(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** `offset`이 속한 줄(1부터)과 열(0부터). */
function locate(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo]! };
}

interface Token {
  from: number;
  to: number;
  text: string;
}

/** scss 산술 연산자 토큰(`$a + $b`). 값의 내용이 아니므로 판정에서 건너뛴다. */
const OPERATOR = /^[+\-*/]$/;

/** 괄호 밖 공백·쉼표로 값을 나눈다. `calc(1px + 2px) 3px` → `calc(1px + 2px)`, `3px`. 괄호 안의 쉼표는 토큰에 남는다. */
function tokenize(value: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let from = -1;
  const close = (to: number): void => {
    if (from !== -1) tokens.push({ from, to, text: value.slice(from, to) });
    from = -1;
  };
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (depth === 0 && (ch === "," || /\s/.test(ch))) {
      close(i);
      continue;
    }
    if (from === -1) from = i;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
  }
  close(value.length);
  return tokens;
}

interface Classified {
  property: StyleProperty;
  /** decl 값 안에서의 대상 구간 */
  from: number;
  to: number;
  normalized: Normalized;
  source: StyleUsage["source"];
}

function classify(prop: string, value: string, dynamic: boolean): Classified {
  const whole = { from: 0, to: value.length };
  const property = cssPropertyToStyleProperty(prop);

  if (dynamic) return { property, ...whole, normalized: UNKNOWN, source: "dynamic" };
  // 값 전체가 토큰 참조뿐일 때만 token. 하드코딩이 섞이면 아래에서 그 부분을 보고한다.
  const tokens = tokenize(value);
  const operands = tokens.filter((t) => !OPERATOR.test(t.text));
  if (operands.length > 0 && operands.every((t) => TOKEN_REF.test(t.text))) {
    return { property, ...whole, normalized: UNKNOWN, source: "token" };
  }

  const shorthand = splitShorthandColor(prop, value);
  if (shorthand !== null) {
    return {
      property: shorthand.property,
      from: shorthand.start,
      to: shorthand.end,
      normalized: normalizeColor(shorthand.colorText) ?? UNKNOWN,
      source: "hardcoded",
    };
  }
  if (isColorProperty(property)) {
    return { property, ...whole, normalized: normalizeColor(value) ?? UNKNOWN, source: "hardcoded" };
  }
  if (isLengthProperty(property)) {
    // 토큰 참조는 건너뛰고 처음 나오는 하드코딩 토큰을 정규화한다(`var(--x) 13px` → 13px).
    const target = operands.find((t) => !TOKEN_REF.test(t.text)) ?? tokens[0];
    if (target === undefined) return { property, ...whole, normalized: UNKNOWN, source: "hardcoded" };
    const px = normalizeLength(target.text);
    return {
      property,
      from: target.from,
      to: target.to,
      normalized: px === null ? UNKNOWN : { kind: "length", px },
      source: "hardcoded",
    };
  }
  return { property, ...whole, normalized: UNKNOWN, source: "hardcoded" };
}

function extract(ctx: ExtractContext): StyleUsage[] {
  const starts = lineStartsOf(ctx.code);
  const usages: StyleUsage[] = [];

  const lineComments = /\.scss$/.test(ctx.file);
  for (const decl of parseCssDeclarations(ctx.code, 0, { lineComments })) {
    const value = decl.value.replace(IMPORTANT, "");
    if (value === "") continue;

    const c = classify(decl.property, value, decl.dynamic);
    const start = decl.start + c.from;
    const end = decl.start + c.to;
    const usage: StyleUsage = {
      file: ctx.file,
      ...locate(starts, start),
      property: c.property,
      raw: ctx.code.slice(start, end),
      normalized: c.normalized,
      source: c.source,
      extractor: EXTRACTOR_NAME,
    };
    if (c.source === "hardcoded") registerPatchTarget(usage, { start, end, file: ctx.file });
    usages.push(usage);
  }
  return usages;
}

/** CSS Modules(`*.module.css`)는 JS 쪽 import와 함께 봐야 하므로 이 추출기 대상이 아니다. */
function appliesTo(ctx: ExtractContext): boolean {
  const base = ctx.file.split(/[\\/]/).pop() ?? ctx.file;
  return /\.(css|scss)$/.test(base) && !base.includes(".module.");
}

export const cssExtractor: Extractor = {
  name: EXTRACTOR_NAME,
  files: ["**/*.{css,scss}"],
  parses: "none",
  appliesTo,
  extract,
  write,
};
