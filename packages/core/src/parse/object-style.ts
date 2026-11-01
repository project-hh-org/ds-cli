import type { StyleProperty, StyleUsage } from "@dsmith/extractor-api";
import type { Expression, NumericLiteral, ObjectExpression, ObjectProperty, PatternLike } from "@babel/types";
import { cssPropertyToStyleProperty, isColorProperty, isLengthProperty } from "../model/css-property.js";
import { normalizeColor } from "../normalize/color.js";
import { normalizeLength } from "../normalize/length.js";

function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/** 값이 색일 때만 색 속성으로 보는 축약 속성. 그 외 값(`1px solid red`, `url(...)`)은 "other"로 둔다. */
const COLOR_SHORTHANDS: Readonly<Record<string, StyleProperty>> = {
  background: "background-color",
  border: "border-color",
  outline: "border-color",
};

function propertyOf(key: string, value: Expression | PatternLike): StyleProperty {
  const shorthand = COLOR_SHORTHANDS[camelToKebab(key)];
  if (shorthand !== undefined && value.type === "StringLiteral" && normalizeColor(value.value) !== null) {
    return shorthand;
  }
  return cssPropertyToStyleProperty(key);
}

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

function normalizeString(raw: string, property: StyleProperty): Normalized {
  if (isColorProperty(property)) return normalizeColor(raw) ?? UNKNOWN;
  const px = normalizeLength(raw);
  return px === null ? UNKNOWN : { kind: "length", px };
}

/** `var(--…)` 값은 CSS 변수(토큰) 참조다. */
const CSS_VAR_REF = /^\s*var\(\s*--/;

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

export interface StyleObjectUsage {
  usage: StyleUsage;
  /** 리터럴 값 노드의 소스 구간(문자열은 따옴표 포함). 리터럴이 아닌 값(dynamic)은 null. */
  patch: { start: number; end: number } | null;
}

function buildUsage(
  ctx: StyleObjectContext,
  property: StyleProperty,
  value: Expression | PatternLike,
): StyleObjectUsage | null {
  const { start, end, loc } = value;
  if (start == null || end == null || loc == null) return null;

  const base = {
    file: ctx.file,
    line: loc.start.line,
    column: loc.start.column,
    property,
    extractor: ctx.extractor,
  };
  const patch = { start, end };

  if (value.type === "StringLiteral") {
    const tokenRef = CSS_VAR_REF.test(value.value);
    const usage: StyleUsage = {
      ...base,
      raw: value.value,
      normalized: tokenRef ? UNKNOWN : normalizeString(value.value, property),
      source: tokenRef ? "token" : "hardcoded",
    };
    return { usage, patch };
  }
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
 * 문자열·숫자·부호 붙은 숫자 리터럴은 hardcoded(`var(--…)` 문자열은 token), 그 밖의 값은 dynamic.
 * 계산된 키·스프레드·메서드는 건너뛴다. 리터럴 값에는 치환할 값 노드 구간을 `patch`로 돌려준다.
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
    const defaultClassify = (asKey: string = key): StyleObjectUsage | null =>
      buildUsage(ctx, propertyOf(asKey, value), value);
    const override = ctx.classify?.(key, value, defaultClassify);
    const result = override === undefined ? defaultClassify() : override;
    if (result !== null) results.push(result);
  }
  return results;
}
