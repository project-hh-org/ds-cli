import type { StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
import {
  cssPropertyToStyleProperty,
  isColorProperty,
  isLengthProperty,
  splitShorthandColor,
} from "../model/css-property.js";
import { normalizeColor } from "../normalize/color.js";
import { normalizeLength } from "../normalize/length.js";
import type { CssDecl } from "./css-text.js";

type Normalized = StyleUsage["normalized"];
const UNKNOWN: Normalized = { kind: "unknown" };

/** 공백으로 나뉜 토큰 하나가 `var(--…)`(CSS 변수) 또는 `$name`(scss 변수)이면 토큰 참조다. */
const TOKEN_REF = /^(?:var\(\s*--.*\)|\$[\w-]+)$/is;
const IMPORTANT = /\s*!\s*important\s*$/i;

/** 코드 오프셋 → 줄(1부터)·열(0부터) 변환 함수를 만든다. 줄 시작 표는 한 번만 계산한다. */
export function lineLocator(code: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "\n") starts.push(i + 1);
  }
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo]! };
  };
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

function classify(prop: string, value: string): Classified {
  const whole = { from: 0, to: value.length };
  const property = cssPropertyToStyleProperty(prop);

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

export interface ClassifyOptions {
  file: string;
  extractor: string;
  /** `decl.start/end`와 같은 좌표계의 원본 텍스트. usage.raw는 여기서 잘라 온다. */
  code: string;
  /** `code` 오프셋 → 줄·열 */
  lineOf(offset: number): { line: number; column: number };
}

/**
 * CSS 선언 하나를 StyleUsage로 분류한다(순수 함수).
 * - dynamic: 값 구간 전체, 패치 없음
 * - 피연산자가 모두 `var(--…)`/`$x`: token, 패치 없음
 * - 축약(`border: 1px solid #000`): 색 토큰 구간만, 길이 속성: 처음 나오는 하드코딩 토큰 구간만
 * - 끝의 `!important`는 떼고 판정한다. 떼고 나서 값이 비면 null.
 * 하드코딩 usage에만 `patch`(치환할 `code` 구간)를 돌려준다.
 */
export function classifyDeclaration(
  decl: CssDecl,
  opts: ClassifyOptions,
): { usage: StyleUsage; patch: { start: number; end: number } | null } | null {
  if (decl.dynamic) {
    const usage: StyleUsage = {
      file: opts.file,
      ...opts.lineOf(decl.start),
      property: cssPropertyToStyleProperty(decl.property),
      raw: opts.code.slice(decl.start, decl.end),
      normalized: UNKNOWN,
      source: "dynamic",
      extractor: opts.extractor,
    };
    return { usage, patch: null };
  }

  const value = decl.value.replace(IMPORTANT, "");
  if (value === "") return null;

  const c = classify(decl.property, value);
  const start = decl.start + c.from;
  const end = decl.start + c.to;
  const usage: StyleUsage = {
    file: opts.file,
    ...opts.lineOf(start),
    property: c.property,
    raw: opts.code.slice(start, end),
    normalized: c.normalized,
    source: c.source,
    extractor: opts.extractor,
  };
  return { usage, patch: c.source === "hardcoded" ? { start, end } : null };
}
