import {
  cssPropertyToStyleProperty,
  isColorProperty,
  isLengthProperty,
  normalizeColor,
  normalizeLength,
  parseTsx,
  traverse,
} from "@dsmith/core";
import { JS_FILES } from "@dsmith/extractor-api";
import type {
  ExtractContext,
  Extractor,
  StyleProperty,
  StyleUsage,
} from "@dsmith/extractor-api";
import type { Expression, NumericLiteral, ObjectProperty, PatternLike } from "@babel/types";
import { registerPatchTarget, write } from "./write.js";

export const EXTRACTOR_NAME = "inline-style";

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

function buildUsage(
  ctx: ExtractContext,
  property: StyleProperty,
  value: Expression | PatternLike,
): StyleUsage | null {
  const { start, end, loc } = value;
  if (start == null || end == null || loc == null) return null;

  const base = {
    file: ctx.file,
    line: loc.start.line,
    column: loc.start.column,
    property,
    extractor: EXTRACTOR_NAME,
  };

  if (value.type === "StringLiteral") {
    const tokenRef = CSS_VAR_REF.test(value.value);
    const usage: StyleUsage = {
      ...base,
      raw: value.value,
      normalized: tokenRef ? UNKNOWN : normalizeString(value.value, property),
      source: tokenRef ? "token" : "hardcoded",
    };
    registerPatchTarget(usage, { start, end, file: ctx.file });
    return usage;
  }
  if (value.type === "NumericLiteral") {
    const usage: StyleUsage = {
      ...base,
      raw: numberRaw(value),
      normalized: normalizeNumber(value.value, property),
      source: "hardcoded",
    };
    registerPatchTarget(usage, { start, end, file: ctx.file });
    return usage;
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
    registerPatchTarget(usage, { start, end, file: ctx.file });
    return usage;
  }
  return {
    ...base,
    raw: ctx.code.slice(start, end),
    normalized: UNKNOWN,
    source: "dynamic",
  };
}

function extract(ctx: ExtractContext): StyleUsage[] {
  // 복구 불가능한 문법 오류는 그대로 던진다. 파일 단위 실패 기록은 호출자(indexer) 몫이다.
  const ast = parseTsx(ctx.code, ctx.file);

  const usages: StyleUsage[] = [];
  traverse(ast, {
    JSXAttribute(path) {
      const { name, value } = path.node;
      if (name.type !== "JSXIdentifier" || name.name !== "style") return;
      if (value?.type !== "JSXExpressionContainer") return;
      if (value.expression.type !== "ObjectExpression") return;

      for (const prop of value.expression.properties) {
        if (prop.type !== "ObjectProperty") continue;
        const key = propertyKeyName(prop);
        if (key === null) continue;
        const usage = buildUsage(ctx, propertyOf(key, prop.value), prop.value);
        if (usage !== null) usages.push(usage);
      }
    },
  });
  return usages;
}

export const inlineStyleExtractor: Extractor = {
  name: EXTRACTOR_NAME,
  files: JS_FILES,
  parses: "tsx",
  appliesTo: (ctx) => /\.[cm]?[jt]sx?$/.test(ctx.file) && ctx.code.includes("style="),
  extract,
  write,
};
