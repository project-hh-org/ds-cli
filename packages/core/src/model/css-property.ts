import type { StyleProperty } from "@dsmith-dev/extractor-api";
import { normalizeColor } from "../normalize/color.js";

/** 길이로 정규화하는 속성. 단위 없는 숫자는 이 속성에서만 px로 본다. */
export const LENGTH_PROPERTIES: ReadonlySet<StyleProperty> = new Set<StyleProperty>([
  "padding",
  "margin",
  "gap",
  "width",
  "height",
  "font-size",
  "border-radius",
]);

/** 색으로 정규화하는 속성. */
export const COLOR_PROPERTIES: ReadonlySet<StyleProperty> = new Set<StyleProperty>([
  "color",
  "background-color",
  "border-color",
  "fill",
  "stroke",
]);

export function isLengthProperty(p: StyleProperty): boolean {
  return LENGTH_PROPERTIES.has(p);
}

export function isColorProperty(p: StyleProperty): boolean {
  return COLOR_PROPERTIES.has(p);
}

function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/** CSS 속성명(camelCase 또는 kebab-case)을 StyleProperty로 분류한다. 모르는 속성은 "other". */
export function cssPropertyToStyleProperty(prop: string): StyleProperty {
  const name = camelToKebab(prop);
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

/** 값 안에 색이 들어갈 수 있는 축약 속성과, 색이 들어갔을 때 승격할 속성. */
const SHORTHAND_COLOR_PROPERTY: Readonly<Record<string, StyleProperty>> = {
  background: "background-color",
  outline: "border-color",
  border: "border-color",
  "border-top": "border-color",
  "border-right": "border-color",
  "border-bottom": "border-color",
  "border-left": "border-color",
};

/** 색을 품는 축약 속성(`border`·`background`·`outline` …)이 가리키는 색 속성. 축약이 아니면 null. */
export function shorthandColorProperty(prop: string): StyleProperty | null {
  return SHORTHAND_COLOR_PROPERTY[camelToKebab(prop)] ?? null;
}

const HEX_COLOR =/^#[0-9a-fA-F]{3,8}(?![\w-])/;
const COLOR_FUNCTION = /^(?:rgba?|hsla?)\(/i;
const WORD = /^[A-Za-z][A-Za-z-]*/;

/** `text[open]`이 `(`일 때 짝이 맞는 `)` 다음 위치. 닫히지 않으면 text.length. */
function skipParens(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return text.length;
}

/** 따옴표 문자열 다음 위치. 닫히지 않으면 text.length. */
function skipString(text: string, open: number): number {
  const close = text.indexOf(text[open]!, open + 1);
  return close === -1 ? text.length : close + 1;
}

/**
 * `background`·`border*`·`outline` 축약 값에서 첫 번째 색 토큰(`#hex`, `rgb[a]()`, `hsl[a]()`, 이름 색)을 찾는다.
 * `url()`·`linear-gradient()` 등 다른 함수와 문자열 안은 보지 않는다. 색이 없거나 축약 속성이 아니면 null.
 * `start`/`end`는 `value` 안의 오프셋이다.
 */
export function splitShorthandColor(
  prop: string,
  value: string,
): { property: StyleProperty; colorText: string; start: number; end: number } | null {
  const property = SHORTHAND_COLOR_PROPERTY[camelToKebab(prop)];
  if (property === undefined) return null;

  let i = 0;
  while (i < value.length) {
    const rest = value.slice(i);
    const ch = value[i]!;

    if (ch === '"' || ch === "'") {
      i = skipString(value, i);
      continue;
    }
    if (ch === "#") {
      const hex = HEX_COLOR.exec(rest);
      if (hex !== null && normalizeColor(hex[0]) !== null) {
        return { property, colorText: hex[0], start: i, end: i + hex[0].length };
      }
      i += 1;
      continue;
    }
    const word = WORD.exec(rest);
    if (word !== null) {
      const end = i + word[0].length;
      if (value[end] === "(") {
        const close = skipParens(value, end);
        if (COLOR_FUNCTION.test(rest)) {
          const colorText = value.slice(i, close);
          if (normalizeColor(colorText) !== null) return { property, colorText, start: i, end: close };
        }
        i = close;
        continue;
      }
      if (normalizeColor(word[0]) !== null) {
        return { property, colorText: word[0], start: i, end };
      }
      i = end;
      continue;
    }
    // 숫자·단위 등: 영숫자 덩어리를 통째로 건너뛰어 `1px`의 `px`를 단어로 오인하지 않는다.
    const chunk = /^[\w.%+-]+/.exec(rest);
    i += chunk === null ? 1 : chunk[0].length;
  }
  return null;
}
