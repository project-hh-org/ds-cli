import { converter, formatHex, parse } from "culori";
import type { NormalizedColor } from "../model/style-usage.js";

const toOklch = converter("oklch");

const NON_COLOR_KEYWORDS = new Set(["transparent", "currentcolor", "inherit", "initial", "unset"]);

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
