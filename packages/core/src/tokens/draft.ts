import type { StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
import { clusterColors } from "../cluster/color-cluster.js";
import { clusterFontSizes } from "../cluster/font-size.js";
import { colorTokenNames, uniqueNames } from "../cluster/names.js";
import { clusterSpacing } from "../cluster/spacing-cluster.js";
import { rankTokens } from "../match/token-matcher.js";
import type { Token } from "../model/token.js";
import { isRatedUsage } from "../model/style-usage.js";
import { tokenCategoryOf } from "./load.js";

export type DraftCategory = Token["category"];
export type DraftGroup = "color" | "space" | "radius" | "text";

export interface DraftToken {
  category: DraftCategory;
  /** W3C 그룹 이름 = CSS 변수 접두사 */
  group: DraftGroup;
  /** 그룹 안 이름: "gray-50" | "2" | "sm" | "full" | "xs" */
  key: string;
  /** `${group}-${key}` — CSS 변수는 `--${name}` */
  name: string;
  /** 색 "#rrggbb"(소문자 6자리), 길이 "8px" */
  value: string;
  normalized: StyleUsage["normalized"];
  /** 병합된 원값들의 사용 수 합 */
  usageCount: number;
  /** 병합된 원값("#3c83f7", "13px"), 사용 수 desc */
  members: string[];
  /** token-cluster 결정으로 값을 정했으면 그 hex */
  chosen?: string;
}

export interface ScaleMapping {
  category: "spacing" | "radius" | "font-size";
  px: number;
  count: number;
  /** 가장 가까운 토큰 name, 그 카테고리 토큰이 없으면 null */
  token: string | null;
  distancePx: number | null;
}

export interface TokenDraft {
  tokens: DraftToken[];
  mappings: ScaleMapping[];
}

export interface DraftOptions {
  /** root 상대 POSIX 디렉터리. 이 아래 파일의 스타일은 입력에서 뺀다 */
  excludeDirs?: string[];
  /** token-cluster 결정: 색 key(예 "blue-400") → 고른 hex. 그 클러스터의 member일 때만 반영 */
  colorChoices?: Record<string, string>;
  limits?: { spacing?: number; radius?: number; fontSize?: number };
}

const SCALE_UNIT_PX = 4;
const DEFAULT_LIMITS = { spacing: 12, radius: 3, fontSize: 8 };
const FULL_RADIUS_MIN_PX = 999;
const FULL_RADIUS_VALUE_PX = 9999;

const RADIUS_LADDER: readonly (readonly [string, number])[] = [
  ["sm", 4],
  ["md", 6],
  ["lg", 8],
];

const FONT_LADDER: readonly (readonly [string, number])[] = [
  ["xs", 12],
  ["sm", 14],
  ["base", 16],
  ["lg", 18],
  ["xl", 20],
  ["2xl", 24],
  ["3xl", 30],
  ["4xl", 36],
  ["5xl", 48],
  ["6xl", 60],
];

function underDir(file: string, dir: string): boolean {
  const base = dir.replace(/\/+$/, "");
  return file === base || file.startsWith(`${base}/`);
}

function filterExcluded(styles: StyleUsage[], excludeDirs: string[] | undefined): StyleUsage[] {
  if (excludeDirs === undefined || excludeDirs.length === 0) return styles;
  return styles.filter((u) => !excludeDirs.some((d) => underDir(u.file, d)));
}

/** 사다리에서 가장 가까운 단계. 동률이면 작은 쪽. */
function nearestStep(px: number, ladder: readonly (readonly [string, number])[]): string {
  let best = ladder[0] as readonly [string, number];
  for (const step of ladder) {
    const d = Math.abs(step[1] - px);
    const bd = Math.abs(best[1] - px);
    if (d < bd || (d === bd && step[1] < best[1])) best = step;
  }
  return best[0];
}

function pxLength(px: number): StyleUsage["normalized"] {
  return { kind: "length", px };
}

function nearestMapping(
  category: ScaleMapping["category"],
  px: number,
  count: number,
  pool: DraftToken[],
): ScaleMapping {
  let best: DraftToken | undefined;
  let bestDistance = Infinity;
  for (const t of pool) {
    if (t.normalized.kind !== "length") continue;
    const d = Math.abs(t.normalized.px - px);
    const tpx = t.normalized.px;
    const bpx = best !== undefined && best.normalized.kind === "length" ? best.normalized.px : Infinity;
    if (d < bestDistance || (d === bestDistance && tpx < bpx)) {
      best = t;
      bestDistance = d;
    }
  }
  if (best === undefined) return { category, px, count, token: null, distancePx: null };
  return { category, px, count, token: best.name, distancePx: bestDistance };
}

function hardcodedRadii(styles: StyleUsage[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const u of styles) {
    if (u.source !== "hardcoded" || u.property !== "border-radius") continue;
    if (u.normalized.kind !== "length" || !(u.normalized.px > 0)) continue;
    const px = Math.round(u.normalized.px * 100) / 100;
    counts.set(px, (counts.get(px) ?? 0) + 1);
  }
  return counts;
}

const byCountThenPx = (a: { px: number; count: number }, b: { px: number; count: number }): number =>
  b.count - a.count || a.px - b.px;

export function buildTokenDraft(styles: StyleUsage[], opts: DraftOptions = {}): TokenDraft {
  const input = filterExcluded(styles, opts.excludeDirs);
  const limits = { ...DEFAULT_LIMITS, ...stripUndefined(opts.limits) };
  const tokens: DraftToken[] = [];
  const mappings: ScaleMapping[] = [];

  // 색
  const colorClusters = clusterColors(input);
  const colorKeys = colorTokenNames(colorClusters);
  const normalizedByHex = new Map<string, StyleUsage["normalized"]>();
  for (const u of input) {
    if (u.source === "hardcoded" && u.normalized.kind === "color" && !normalizedByHex.has(u.normalized.hex)) {
      normalizedByHex.set(u.normalized.hex, u.normalized);
    }
  }
  colorClusters.forEach((cluster, i) => {
    const key = colorKeys[i] as string;
    const members = [...cluster.members].sort((a, b) => b.count - a.count);
    const choice = opts.colorChoices?.[key];
    const chosenNormalized =
      choice !== undefined && cluster.members.some((m) => m.hex === choice)
        ? normalizedByHex.get(choice)
        : undefined;
    const token: DraftToken = {
      category: "color",
      group: "color",
      key,
      name: `color-${key}`,
      value: chosenNormalized !== undefined && chosenNormalized.kind === "color" ? chosenNormalized.hex : cluster.representative.hex,
      normalized: chosenNormalized ?? cluster.representative,
      usageCount: cluster.total,
      members: members.map((m) => m.hex),
    };
    if (chosenNormalized !== undefined && chosenNormalized.kind === "color") token.chosen = chosenNormalized.hex;
    tokens.push(token);
  });

  // 간격
  const spacingAll = clusterSpacing(input).filter((c) => c.onScale && c.px > 0);
  const spacingKept = spacingAll.slice(0, limits.spacing).sort((a, b) => a.px - b.px);
  const spacingTokens: DraftToken[] = spacingKept.map((c) => {
    const key = String(c.px / SCALE_UNIT_PX);
    return {
      category: "spacing",
      group: "space",
      key,
      name: `space-${key}`,
      value: `${c.px}px`,
      normalized: pxLength(c.px),
      usageCount: c.count,
      members: [`${c.px}px`],
    };
  });
  tokens.push(...spacingTokens);

  // 모서리
  const radii = hardcodedRadii(input);
  const radiusEntries = [...radii.entries()].map(([px, count]) => ({ px, count }));
  const fullEntries = radiusEntries.filter((e) => e.px >= FULL_RADIUS_MIN_PX);
  const normalRadii = radiusEntries.filter((e) => e.px < FULL_RADIUS_MIN_PX).sort(byCountThenPx);
  const radiusKept = normalRadii.slice(0, limits.radius).sort((a, b) => a.px - b.px);
  const radiusKeys = uniqueNames(radiusKept.map((e) => nearestStep(e.px, RADIUS_LADDER)));
  const radiusTokens: DraftToken[] = radiusKept.map((e, i) => {
    const key = radiusKeys[i] as string;
    return {
      category: "radius",
      group: "radius",
      key,
      name: `radius-${key}`,
      value: `${e.px}px`,
      normalized: pxLength(e.px),
      usageCount: e.count,
      members: [`${e.px}px`],
    };
  });
  if (fullEntries.length > 0) {
    const sorted = [...fullEntries].sort(byCountThenPx);
    radiusTokens.push({
      category: "radius",
      group: "radius",
      key: "full",
      name: "radius-full",
      value: `${FULL_RADIUS_VALUE_PX}px`,
      normalized: pxLength(FULL_RADIUS_VALUE_PX),
      usageCount: sorted.reduce((s, e) => s + e.count, 0),
      members: sorted.map((e) => `${e.px}px`),
    });
  }
  tokens.push(...radiusTokens);

  // 글꼴 크기
  const fontClusters = clusterFontSizes(input);
  const fontKept = fontClusters.slice(0, limits.fontSize).sort((a, b) => a.px - b.px);
  const fontKeys = uniqueNames(fontKept.map((c) => nearestStep(c.px, FONT_LADDER)));
  const fontTokens: DraftToken[] = fontKept.map((c, i) => {
    const key = fontKeys[i] as string;
    return {
      category: "font-size",
      group: "text",
      key,
      name: `text-${key}`,
      value: `${c.px}px`,
      normalized: pxLength(c.px),
      usageCount: c.total,
      members: c.members.map((m) => `${m.px}px`),
    };
  });
  tokens.push(...fontTokens);

  // 토큰이 되지 못한 관측값 → 가장 가까운 토큰
  const rest: ScaleMapping[] = [];
  const spacingLeft = clusterSpacing(input)
    .filter((c) => c.px > 0 && !spacingKept.some((k) => k.px === c.px))
    .sort(byCountThenPx);
  for (const c of spacingLeft) rest.push(nearestMapping("spacing", c.px, c.count, spacingTokens));
  for (const e of normalRadii.filter((e) => !radiusKept.some((k) => k.px === e.px)).sort(byCountThenPx)) {
    rest.push(nearestMapping("radius", e.px, e.count, radiusTokens));
  }
  for (const c of fontClusters.filter((c) => !fontKept.some((k) => k.px === c.px))) {
    rest.push(nearestMapping("font-size", c.px, c.total, fontTokens));
  }
  mappings.push(...rest);

  return { tokens, mappings };
}

function stripUndefined<T extends object>(obj: T | undefined): Partial<T> {
  if (obj === undefined) return {};
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const COVERAGE_PROPERTIES: readonly StyleProperty[] = [
  "color",
  "background-color",
  "border-color",
  "fill",
  "stroke",
  "padding",
  "margin",
  "gap",
  "border-radius",
  "font-size",
];

export interface Coverage {
  replaceable: number;
  total: number;
  rate: number | null;
  byCategory: Record<DraftCategory, { replaceable: number; total: number }>;
}

export function draftCoverage(
  styles: StyleUsage[],
  tokens: Token[],
  opts: { excludeDirs?: string[] } = {},
): Coverage {
  const byCategory: Coverage["byCategory"] = {
    color: { replaceable: 0, total: 0 },
    spacing: { replaceable: 0, total: 0 },
    radius: { replaceable: 0, total: 0 },
    "font-size": { replaceable: 0, total: 0 },
  };
  let replaceable = 0;
  let total = 0;

  for (const u of filterExcluded(styles, opts.excludeDirs)) {
    if (u.source !== "hardcoded" || !isRatedUsage(u) || !COVERAGE_PROPERTIES.includes(u.property)) continue;
    const category = tokenCategoryOf(u.property);
    if (category === null) continue;
    const top = rankTokens(u.normalized, tokens, { category, limit: 1 })[0];
    const ok = top !== undefined && (top.confidence === "exact" || top.confidence === "close");
    total += 1;
    byCategory[category].total += 1;
    if (ok) {
      replaceable += 1;
      byCategory[category].replaceable += 1;
    }
  }

  return {
    replaceable,
    total,
    rate: total === 0 ? null : Math.round((replaceable / total) * 10000) / 10000,
    byCategory,
  };
}

/** 매칭용 Token[] — name은 `--${name}`(CSS 변수와 같은 이름) */
export function draftToTokens(draft: TokenDraft): Token[] {
  return draft.tokens.map((t) => ({
    name: `--${t.name}`,
    value: t.value,
    normalized: t.normalized,
    category: t.category,
  }));
}
