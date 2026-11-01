/**
 * W3C Design Tokens Format Module 2025.10 직렬화·읽기.
 * 근거(부록 B.1·B.2, 2026-11-01 확인):
 *  - https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/
 *  - https://w3c.github.io/cg-reports/design-tokens/CG-FINAL-color-20251028/
 * color `$value`는 객체 { colorSpace, components, hex(6자리) }, dimension은 { value, unit }.
 * fontSize·borderRadius 타입은 없으므로 모두 dimension으로 쓴다. 확장 키는 역도메인 "dev.dsmith".
 * 읽기는 2025 이전 초안의 문자열 값("#3b82f6", "8px")도 받는다.
 */
import { converter, parse } from "culori";
import type { Token } from "../model/token.js";
import { normalizeColor } from "../normalize/color.js";
import { normalizeLength } from "../normalize/length.js";
import type { DraftGroup, TokenDraft } from "./draft.js";
import { GENERATED_NOTICE } from "./emit.js";

export const DSMITH_EXTENSION = "dev.dsmith";

export interface W3cColorValue {
  colorSpace: "srgb";
  components: [number, number, number];
  hex: string;
}
export interface W3cDimensionValue {
  value: number;
  unit: "px";
}
export interface DsmithExtension {
  category: Token["category"];
  usageCount: number;
  members: string[];
  chosen?: string;
}

const GROUPS: readonly DraftGroup[] = ["color", "space", "radius", "text"];
const toRgb = converter("rgb");

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function colorValue(hex: string): W3cColorValue {
  const rgb = toRgb(hex);
  const c = (n: number | undefined): number => round4(Math.min(1, Math.max(0, n ?? 0)));
  return {
    colorSpace: "srgb",
    components: [c(rgb?.r), c(rgb?.g), c(rgb?.b)],
    hex: hex.toLowerCase(),
  };
}

export function draftToW3c(draft: TokenDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { $description: GENERATED_NOTICE };
  for (const group of GROUPS) {
    const entries = draft.tokens.filter((t) => t.group === group);
    if (entries.length === 0) continue;
    const node: Record<string, unknown> = {};
    for (const t of entries) {
      const extension: DsmithExtension = {
        category: t.category,
        usageCount: t.usageCount,
        members: t.members,
        ...(t.chosen === undefined ? {} : { chosen: t.chosen }),
      };
      const isColor = t.normalized.kind === "color";
      node[t.key] = {
        $type: isColor ? "color" : "dimension",
        $value: isColor
          ? colorValue(t.value)
          : ({ value: t.normalized.kind === "length" ? t.normalized.px : 0, unit: "px" } satisfies W3cDimensionValue),
        $extensions: { [DSMITH_EXTENSION]: extension },
      };
    }
    out[group] = node;
  }
  return out;
}

export function serializeW3c(draft: TokenDraft): string {
  return `${JSON.stringify(draftToW3c(draft), null, 2)}\n`;
}

export interface W3cReadResult {
  tokens: Token[];
  warnings: string[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const MAX_ALIAS_DEPTH = 5;
const ALIAS = /^\{([^{}]+)\}$/;
const RADIUS_GROUPS = new Set(["radius", "radii", "rounded", "border-radius"]);
const FONT_SIZE_GROUPS = new Set(["text", "font-size", "fontsize", "font-sizes", "fontsizes"]);
const FUNCTION_SPACES = new Set(["hsl", "hwb", "lab", "lch", "oklab", "oklch"]);

interface Entry {
  path: string[];
  node: Json;
  type: string | undefined;
}

function walk(node: Json, path: string[], inherited: string | undefined, out: Entry[]): void {
  const type = typeof node.$type === "string" ? node.$type : inherited;
  if ("$value" in node) {
    out.push({ path, node, type });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") || !isObject(child)) continue;
    walk(child, [...path, key], type, out);
  }
}

function colorFromObject(value: Json): ReturnType<typeof normalizeColor> {
  if (typeof value.hex === "string") {
    const fromHex = normalizeColor(value.hex);
    if (fromHex !== null) return fromHex;
  }
  const space = value.colorSpace;
  const comps = value.components;
  if (typeof space !== "string" || !Array.isArray(comps) || comps.length < 3) return null;
  const nums = comps.slice(0, 3).map((c) => (typeof c === "number" ? c : 0));
  const css = FUNCTION_SPACES.has(space)
    ? `${space}(${nums.join(" ")})`
    : `color(${space} ${nums.join(" ")})`;
  return parse(css) === undefined ? null : normalizeColor(css);
}

function categoryOf(entry: Entry, kind: "color" | "length"): Token["category"] {
  const ext = isObject(entry.node.$extensions) ? entry.node.$extensions[DSMITH_EXTENSION] : undefined;
  const declared = isObject(ext) ? ext.category : undefined;
  if (declared === "color" || declared === "spacing" || declared === "radius" || declared === "font-size") {
    return declared;
  }
  if (kind === "color") return "color";
  const head = (entry.path[0] ?? "").toLowerCase();
  if (RADIUS_GROUPS.has(head)) return "radius";
  if (FONT_SIZE_GROUPS.has(head)) return "font-size";
  return "spacing";
}

export function readW3cTokens(text: string, file: string): W3cReadResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { tokens: [], warnings: [`토큰 JSON을 읽을 수 없음: ${file}`] };
  }
  if (!isObject(root)) return { tokens: [], warnings: [`토큰 JSON을 읽을 수 없음: ${file}`] };

  const entries: Entry[] = [];
  walk(root, [], undefined, entries);
  const byPath = new Map(entries.map((e) => [e.path.join("."), e]));
  const warnings: string[] = [];
  const tokens: Token[] = [];

  for (const entry of entries) {
    const label = entry.path.join(".");
    let value: unknown = entry.node.$value;
    let type = entry.type;
    let failed = false;
    const visited = new Set<string>([label]);
    for (let depth = 0; typeof value === "string" && ALIAS.test(value); depth++) {
      const target = ALIAS.exec(value)![1]!;
      const next = byPath.get(target);
      if (next === undefined || visited.has(target) || depth >= MAX_ALIAS_DEPTH) {
        warnings.push(`토큰 별칭을 해석할 수 없음: ${label} → ${value} (${file})`);
        failed = true;
        break;
      }
      visited.add(target);
      value = next.node.$value;
      type ??= next.type;
    }
    if (failed) continue;
    if (isObject(value) && "$ref" in value) {
      warnings.push(`$ref는 지원하지 않음: ${label} (${file})`);
      continue;
    }
    if (type !== "color" && type !== "dimension") continue;

    const name = `--${entry.path.join("-")}`;
    if (type === "color") {
      const normalized =
        typeof value === "string" ? normalizeColor(value) : isObject(value) ? colorFromObject(value) : null;
      if (normalized === null) {
        warnings.push(`색 값을 읽을 수 없음: ${label} (${file})`);
        continue;
      }
      tokens.push({ name, value: normalized.hex, normalized, category: categoryOf(entry, "color") });
      continue;
    }
    let raw: string | null = null;
    if (typeof value === "string") raw = value;
    else if (isObject(value) && typeof value.value === "number" && (value.unit === "px" || value.unit === "rem")) {
      raw = `${value.value}${value.unit}`;
    }
    const px = raw === null ? null : normalizeLength(raw);
    if (raw === null || px === null) {
      warnings.push(`길이 값을 읽을 수 없음: ${label} (${file})`);
      continue;
    }
    tokens.push({ name, value: raw, normalized: { kind: "length", px }, category: categoryOf(entry, "length") });
  }
  return { tokens, warnings };
}
