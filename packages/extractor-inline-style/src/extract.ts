import { normalizeColor, normalizeLength, parseTsx, traverse } from "@ds-cli/core";
import type {
  ExtractContext,
  Extractor,
  StyleProperty,
  StyleUsage,
} from "@ds-cli/extractor-api";
import type { Expression, ObjectProperty, PatternLike } from "@babel/types";
import { registerPatchTarget, write } from "./write.js";

export const EXTRACTOR_NAME = "inline-style";

const COLOR_PROPERTIES: ReadonlySet<StyleProperty> = new Set<StyleProperty>([
  "color",
  "background-color",
  "border-color",
  "fill",
  "stroke",
]);

function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/** React style 객체 키(camelCase 또는 kebab-case)를 StyleProperty로 분류한다. 모르는 키는 "other". */
export function cssPropertyToStyleProperty(cssProp: string): StyleProperty {
  const name = camelToKebab(cssProp);
  if (/^border(-(top|right|bottom|left))?-color$/.test(name)) return "border-color";
  if (/^border(-[a-z]+)*-radius$/.test(name)) return "border-radius";
  if (/^padding(-|$)/.test(name)) return "padding";
  if (/^margin(-|$)/.test(name)) return "margin";
  switch (name) {
    case "color":
    case "background-color":
    case "fill":
    case "stroke":
    case "font-size":
      return name;
    case "gap":
    case "row-gap":
    case "column-gap":
      return "gap";
    case "width":
    case "min-width":
    case "max-width":
      return "width";
    case "height":
    case "min-height":
    case "max-height":
      return "height";
    default:
      return "other";
  }
}

function propertyKeyName(prop: ObjectProperty): string | null {
  if (prop.computed) return null;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "StringLiteral") return prop.key.value;
  return null;
}

type Normalized = StyleUsage["normalized"];
const UNKNOWN: Normalized = { kind: "unknown" };

function normalizeString(raw: string, property: StyleProperty): Normalized {
  if (COLOR_PROPERTIES.has(property)) return normalizeColor(raw) ?? UNKNOWN;
  const px = normalizeLength(raw);
  return px === null ? UNKNOWN : { kind: "length", px };
}

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
    const usage: StyleUsage = {
      ...base,
      raw: value.value,
      normalized: normalizeString(value.value, property),
      source: "hardcoded",
    };
    registerPatchTarget(usage, { start, end, file: ctx.file });
    return usage;
  }
  if (value.type === "NumericLiteral") {
    const usage: StyleUsage = {
      ...base,
      raw: String(value.value),
      normalized: { kind: "length", px: value.value },
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
  let ast;
  try {
    ast = parseTsx(ctx.code, ctx.file);
  } catch {
    // errorRecovery로도 복구되지 않는 문법 오류: 파일 하나 때문에 스캔 전체를 중단하지 않는다.
    return [];
  }

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
        const usage = buildUsage(ctx, cssPropertyToStyleProperty(key), prop.value);
        if (usage !== null) usages.push(usage);
      }
    },
  });
  return usages;
}

export const inlineStyleExtractor: Extractor = {
  name: EXTRACTOR_NAME,
  appliesTo: (ctx) => /\.[tj]sx$/.test(ctx.file) && ctx.code.includes("style="),
  extract,
  write,
};
