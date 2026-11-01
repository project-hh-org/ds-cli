import type { StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
import type { Expression, NumericLiteral, ObjectExpression, ObjectProperty, PatternLike, StringLiteral } from "@babel/types";
import { cssPropertyToStyleProperty, isLengthProperty } from "../model/css-property.js";
import { classifyDeclaration, lineLocator } from "./css-decl-usage.js";

function propertyKeyName(prop: ObjectProperty): string | null {
  if (prop.computed) return null;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "StringLiteral") return prop.key.value;
  return null;
}

type Normalized = StyleUsage["normalized"];
const UNKNOWN: Normalized = { kind: "unknown" };

/** 단위 없는 숫자는 길이 속성에서만 px로 본다. opacity·zIndex·fontWeight 등은 길이가 아니다. */
function normalizeNumber(px: number, property: StyleProperty): Normalized {
  return isLengthProperty(property) ? { kind: "length", px } : UNKNOWN;
}

/** 숫자 리터럴의 원본 소스 텍스트(`1.50` 등). */
function numberRaw(node: NumericLiteral): string {
  const raw = node.extra?.raw;
  return typeof raw === "string" ? raw : String(node.value);
}

/** 같은 파일의 객체가 여럿이어도 줄 시작 표를 한 번만 만든다. */
let cachedLocator: { code: string; lineOf: (offset: number) => { line: number; column: number } } | null = null;

function locatorFor(code: string): (offset: number) => { line: number; column: number } {
  if (cachedLocator?.code !== code) cachedLocator = { code, lineOf: lineLocator(code) };
  return cachedLocator.lineOf;
}

export interface StyleObjectContext {
  file: string;
  code: string;
  extractor: string;
  /** true면 객체 값(`"&:hover": {…}`, `[bp]: {…}`)을 같은 규칙으로 재귀하고 그 키 자체는 usage를 내지 않는다. 기본 false. */
  nested?: boolean;
  /**
   * 속성별 분류 override. undefined를 돌려주면 기본 분류(`defaultClassify`)를 쓴다.
   * `defaultClassify(asKey)`는 원래 키 대신 `asKey`를 CSS 속성명으로 보고 분류한다(`bgcolor` → `background-color` 같은 별칭 키용).
   */
  classify?: (
    key: string,
    value: Expression | PatternLike,
    defaultClassify: (asKey?: string) => StyleObjectUsage | null,
  ) => StyleObjectUsage | null | undefined;
}

/**
 * 치환할 소스 구간.
 * - `quote: false`: 문자열 리터럴 따옴표 안의 하위 구간(`"1px solid #000"`의 `#000`). `tokenRef`를 그대로 넣는다.
 * - `quote: true`: 숫자 리터럴 노드 전체(`12`, `-4`). `tokenRef`를 JS 문자열 리터럴로 감싸 넣는다.
 */
export interface StyleObjectPatch {
  start: number;
  end: number;
  quote: boolean;
}

export interface StyleObjectUsage {
  usage: StyleUsage;
  /** 하드코딩 리터럴 값의 치환 구간. token·dynamic 값은 null. */
  patch: StyleObjectPatch | null;
}

/**
 * 문자열 값은 CSS 텍스트 선언과 같은 `classifyDeclaration`으로 분류한다(축약 색 분리, `!important` 제거, 피연산자 단위 token 판정).
 * 선언 값은 따옴표 안의 소스 텍스트다. 이스케이프가 없으면 `value.value`와 같고, 있어도 구간이 원본 오프셋과 1:1로 맞는다.
 */
function fromString(ctx: StyleObjectContext, key: string, value: StringLiteral, start: number, end: number): StyleObjectUsage | null {
  const inner = ctx.code.slice(start + 1, end - 1);
  const lead = inner.length - inner.trimStart().length;
  const text = inner.trim();
  const valueStart = start + 1 + lead;
  const result = classifyDeclaration(
    { property: key, value: text, start: valueStart, end: valueStart + text.length, dynamic: false },
    { file: ctx.file, extractor: ctx.extractor, code: ctx.code, lineOf: locatorFor(ctx.code) },
  );
  if (result === null) return null;
  return { usage: result.usage, patch: result.patch === null ? null : { ...result.patch, quote: false } };
}

function buildUsage(ctx: StyleObjectContext, key: string, value: Expression | PatternLike): StyleObjectUsage | null {
  const { start, end, loc } = value;
  if (start == null || end == null || loc == null) return null;

  if (value.type === "StringLiteral") return fromString(ctx, key, value, start, end);

  const property = cssPropertyToStyleProperty(key);
  const base = {
    file: ctx.file,
    line: loc.start.line,
    column: loc.start.column,
    property,
    extractor: ctx.extractor,
  };
  const patch = { start, end, quote: true };

  if (value.type === "NumericLiteral") {
    const usage: StyleUsage = {
      ...base,
      raw: numberRaw(value),
      normalized: normalizeNumber(value.value, property),
      source: "hardcoded",
    };
    return { usage, patch };
  }
  if (
    value.type === "UnaryExpression" &&
    (value.operator === "-" || value.operator === "+") &&
    value.argument.type === "NumericLiteral"
  ) {
    const px = value.operator === "-" ? -value.argument.value : value.argument.value;
    const usage: StyleUsage = {
      ...base,
      raw: `${value.operator === "-" ? "-" : ""}${numberRaw(value.argument)}`,
      normalized: normalizeNumber(px, property),
      source: "hardcoded",
    };
    return { usage, patch };
  }
  const usage: StyleUsage = {
    ...base,
    raw: ctx.code.slice(start, end),
    normalized: UNKNOWN,
    source: "dynamic",
  };
  return { usage, patch: null };
}

/**
 * 스타일 객체 리터럴(`{ color: "#fff", padding: 12 }`)의 최상위 속성을 StyleUsage로 바꾼다.
 * 문자열 리터럴은 CSS 텍스트와 같은 선언 분류기(`classifyDeclaration`)로, 숫자·부호 붙은 숫자 리터럴은 hardcoded, 그 밖의 값은 dynamic.
 * 계산된 키·스프레드·메서드는 건너뛴다. 하드코딩 리터럴에는 치환 구간을 `patch`로 돌려준다.
 * `ctx.nested`면 객체 값은 키(계산된 키 포함)와 상관없이 재귀한다.
 */
export function usagesFromStyleObject(obj: ObjectExpression, ctx: StyleObjectContext): StyleObjectUsage[] {
  const results: StyleObjectUsage[] = [];
  for (const prop of obj.properties) {
    if (prop.type !== "ObjectProperty") continue;
    if (ctx.nested === true && prop.value.type === "ObjectExpression") {
      results.push(...usagesFromStyleObject(prop.value, ctx));
      continue;
    }
    const key = propertyKeyName(prop);
    if (key === null) continue;
    const value = prop.value;
    const defaultClassify = (asKey: string = key): StyleObjectUsage | null => buildUsage(ctx, asKey, value);
    const override = ctx.classify?.(key, value, defaultClassify);
    const result = override === undefined ? defaultClassify() : override;
    if (result !== null) results.push(result);
  }
  return results;
}
