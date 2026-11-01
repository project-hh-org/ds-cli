import { converter, formatHex, parse } from "culori";
import type { NormalizedColor } from "../model/style-usage.js";

const toOklch = converter("oklch");

const NON_COLOR_KEYWORDS = new Set(["transparent", "currentcolor", "inherit", "initial", "unset"]);

/**
 * 값에 alpha < 1이 들어 있는가(`rgba(…, .5)`·`/ 50%`·4·8자리 hex). `NormalizedColor`는 alpha를 담지 않아
 * 반투명 색도 불투명 색과 거리 0으로 매칭되므로, 토큰으로 바꾸기 전에 이 함수로 걸러야 한다.
 * 해석할 수 없는 값은 false.
 */
export function isTranslucentColor(raw: string): boolean {
  const parsed = parse(raw.trim());
  return parsed?.alpha !== undefined && parsed.alpha < 1;
}

export function normalizeColor(raw: string): NormalizedColor | null {
  const input = raw.trim();
  if (NON_COLOR_KEYWORDS.has(input.toLowerCase())) return null;

  const parsed = parse(input);
  if (parsed === undefined) return null;

  const oklch = toOklch(parsed);
  return {
    kind: "color",
    hex: formatHex(parsed),
    l: oklch.l,
    c: oklch.c,
    h: oklch.h ?? 0,
  };
}
