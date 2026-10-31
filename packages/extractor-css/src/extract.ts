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

/** `var(--…)`(CSS 변수) 또는 `$name`(scss 변수) 값은 토큰 참조다. */
const TOKEN_REF = /^(?:var\(\s*--|\$)/i;
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

/** 괄호 밖 첫 공백 전까지의 토큰 길이. `calc(1px + 2px) 3px` → `calc(1px + 2px)`. */
function firstTokenLength(value: string): number {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch)) return i;
  }
  return value.length;
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
  if (TOKEN_REF.test(value)) return { property, ...whole, normalized: UNKNOWN, source: "token" };

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
    const to = firstTokenLength(value);
    const px = normalizeLength(value.slice(0, to));
    return {
      property,
      from: 0,
      to,
      normalized: px === null ? UNKNOWN : { kind: "length", px },
      source: "hardcoded",
    };
  }
  return { property, ...whole, normalized: UNKNOWN, source: "hardcoded" };
}

function extract(ctx: ExtractContext): StyleUsage[] {
  const starts = lineStartsOf(ctx.code);
  const usages: StyleUsage[] = [];

  for (const decl of parseCssDeclarations(ctx.code)) {
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
