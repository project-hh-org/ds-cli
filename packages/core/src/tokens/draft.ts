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
  /**
   * 병합된 원값("#3c83f7", "13px"), 사용 수 desc.
   * 추론 토큰(`inferred`)의 members는 값이 토큰 값(스텝)과 다른 오프스케일 원값을 가장 가까운 스텝으로 모은 목록일 뿐이다 —
   * 이것이 `draftCoverage`의 "바꿀 수 있음"이나 migrate의 치환 대상과 같다는 뜻이 아니다(치환 가능 여부는 `rankTokens`의 exact/close로만 정한다).
   */
  members: string[];
  /** token-cluster 결정으로 값을 정했으면 그 hex */
  chosen?: string;
  /** 길이 토큰의 단위 (색 토큰에는 없다) */
  unit?: "px";
  /** 오프스케일 값들의 가장 가까운 4px 스텝으로 추론해 넣은 간격 토큰 */
  inferred?: true;
}

/**
 * 토큰이 되지 못한 관측값과 가장 가까운 토큰. 거리(`distancePx`)가 커서 "close"에 못 드는 값은 가까운 토큰이 있어도
 * `draftCoverage`의 "바꿀 수 있음"으로 세지 않는다(매핑은 참고용, 치환 가능 여부는 매처가 정한다).
 */
export interface ScaleMapping {
  category: "spacing" | "radius" | "font-size";
  px: number;
  count: number;
  /** 가장 가까운 초안 토큰 name, 그 카테고리 토큰이 없으면 null */
  token: string | null;
  distancePx: number | null;
  /** (간격만) 가장 가까운 4px 스텝 px, 동률이면 작은 스텝 */
  scaleStep?: number;
  /** (간격만) `space-${scaleStep/4}` */
  scaleName?: string;
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
export const FULL_RADIUS_MIN_PX = 999;
const INFER_MIN_USAGE = 3;
const FULL_RADIUS_VALUE_PX = 9999;

const RADIUS_LADDER: readonly (readonly [string, number])[] = [
  ["2xs", 2],
  ["xs", 3],
  ["sm", 4],
  ["md", 6],
  ["lg", 8],
  ["xl", 12],
  ["2xl", 16],
];

const FONT_LADDER: readonly (readonly [string, number])[] = [
  ["2xs", 10],
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
  ["7xl", 72],
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

function spacingToken(key: number, count: number, members: string[]): DraftToken {
  const px = key * SCALE_UNIT_PX;
  return {
    category: "spacing",
    group: "space",
    key: String(key),
    name: `space-${key}`,
    value: `${px}px`,
    normalized: pxLength(px),
    usageCount: count,
    members,
    unit: "px",
  };
}

/** 가장 가까운 4px 스텝. 동률이면 작은 스텝. */
function nearestSpacingStep(px: number): number {
  const lower = Math.floor(px / SCALE_UNIT_PX) * SCALE_UNIT_PX;
  return px - lower <= lower + SCALE_UNIT_PX - px ? lower : lower + SCALE_UNIT_PX;
}

function lengthPx(t: DraftToken): number {
  return t.normalized.kind === "length" ? t.normalized.px : 0;
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
    const choice = opts.colorChoices?.[key]?.toLowerCase();
    const chosenNormalized =
      choice !== undefined && cluster.members.some((m) => m.hex.toLowerCase() === choice)
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
  const spacingObserved = clusterSpacing(input).filter((c) => c.px > 0);
  const spacingKept = spacingObserved.filter((c) => c.onScale).slice(0, limits.spacing);
  const spacingTokens: DraftToken[] = spacingKept.map((c) => spacingToken(c.px / SCALE_UNIT_PX, c.count, [`${c.px}px`]));
  // 오프스케일 값을 가장 가까운 4px 스텝으로 모아, 합계가 충분하면 그 스텝을 추론 토큰으로 넣는다.
  const offScaleByStep = new Map<number, { count: number; members: { px: number; count: number }[] }>();
  for (const c of spacingObserved) {
    if (c.onScale) continue;
    const step = nearestSpacingStep(c.px);
    const entry = offScaleByStep.get(step) ?? { count: 0, members: [] };
    entry.count += c.count;
    entry.members.push({ px: c.px, count: c.count });
    offScaleByStep.set(step, entry);
  }
  for (const [step, entry] of offScaleByStep) {
    if (step <= 0 || entry.count < INFER_MIN_USAGE) continue;
    if (spacingTokens.some((t) => t.normalized.kind === "length" && t.normalized.px === step)) continue;
    const members = [...entry.members].sort(byCountThenPx).map((m) => `${m.px}px`);
    spacingTokens.push({ ...spacingToken(step / SCALE_UNIT_PX, entry.count, members), inferred: true });
  }
  spacingTokens.sort((a, b) => lengthPx(a) - lengthPx(b));
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
      unit: "px",
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
      unit: "px",
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
      unit: "px",
    };
  });
  tokens.push(...fontTokens);

  // 토큰이 되지 못한 관측값 → 가장 가까운 토큰
  const rest: ScaleMapping[] = [];
  const spacingLeft = spacingObserved
    .filter((c) => !spacingKept.some((k) => k.px === c.px))
    .sort(byCountThenPx);
  for (const c of spacingLeft) {
    const scaleStep = nearestSpacingStep(c.px);
    rest.push({
      ...nearestMapping("spacing", c.px, c.count, spacingTokens),
      scaleStep,
      scaleName: `space-${scaleStep / SCALE_UNIT_PX}`,
    });
  }
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
  /** 분모에서 뺀 0 이하 간격(padding·margin·gap) 사용 수 */
  zeroOrNegative: number;
}

export interface Replacement {
  token: Token;
  confidence: "exact" | "close";
  distance: number;
}

/**
 * 이 하드코딩 값을 바꿀 `tokens` 중 하나. 매처(`rankTokens`) 1위가 같은 카테고리에서 exact 또는 close면 그 토큰.
 * 아니면 999px 이상 모서리(`radius-full` 값)는 px ≥ `FULL_RADIUS_MIN_PX`인 radius 토큰 중 px가 가장 가까운 것(동률이면 먼저 나온 것)(px가 같으면 "exact", 아니면 "close", distance = |차|).
 * 토큰 대상 속성(`COVERAGE_PROPERTIES`: 색·간격·모서리·글꼴 크기. width·height 제외)이 아니거나 바꿀 토큰이 없으면 null.
 * 커버리지의 분모 제외(0 이하 간격, 평가 제외 사용)는 호출자의 몫이다.
 * `draftCoverage`의 "바꿀 수 있음"(`replaceableToken`)과 마이그레이션이 이 함수 하나를 쓴다.
 */
export function bestReplacement(usage: StyleUsage, tokens: Token[]): Replacement | null {
  if (!COVERAGE_PROPERTIES.includes(usage.property)) return null;
  const category = tokenCategoryOf(usage.property);
  if (category === null) return null;
  const top = rankTokens(usage.normalized, tokens, { category, limit: 1 })[0];
  if (top !== undefined && (top.confidence === "exact" || top.confidence === "close")) {
    return { token: top.token, confidence: top.confidence, distance: top.distance };
  }
  if (category === "radius" && usage.normalized.kind === "length" && usage.normalized.px >= FULL_RADIUS_MIN_PX) {
    const px = usage.normalized.px;
    let best: Replacement | null = null;
    for (const t of tokens) {
      if (t.category !== "radius" || t.normalized.kind !== "length" || t.normalized.px < FULL_RADIUS_MIN_PX) continue;
      const distance = Math.abs(t.normalized.px - px);
      if (best === null || distance < best.distance) best = { token: t, confidence: distance === 0 ? "exact" : "close", distance };
    }
    return best;
  }
  return null;
}

/** `bestReplacement`가 토큰을 고르는가 — 판정은 그 함수 하나. */
export function replaceableToken(usage: StyleUsage, tokens: Token[]): boolean {
  return bestReplacement(usage, tokens) !== null;
}

/**
 * 색·글꼴 크기 토큰은 이 초안이 하드코딩 값에서 직접 만든 것이라 커버리지가 거의 100%다(구성상 그렇다).
 * 그래서 이 숫자는 사실상 간격(4px 스케일에 걸리지 않는 값) 커버리지를 반영한다.
 * 대상 = hardcoded 사용 중 0 이하 간격은 제외하고 `zeroOrNegative`로 따로 센다.
 * 999px 이상 모서리는 `radius-full`이 있으면 바꿀 수 있는 것으로 센다.
 * 바꿀 수 있음 = 매처가 exact·close로 판정한 값. 스케일 밖 값을 `ScaleMapping`이 먼 토큰에 대응시켰더라도 세지 않고,
 * 추론 토큰의 `members`가 전부 바뀐다는 뜻도 아니다.
 */
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
  let zeroOrNegative = 0;
  for (const u of filterExcluded(styles, opts.excludeDirs)) {
    if (u.source !== "hardcoded" || !isRatedUsage(u) || !COVERAGE_PROPERTIES.includes(u.property)) continue;
    const category = tokenCategoryOf(u.property);
    if (category === null) continue;
    if (category === "spacing" && u.normalized.kind === "length" && u.normalized.px <= 0) {
      zeroOrNegative += 1;
      continue;
    }
    const ok = replaceableToken(u, tokens);
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
    zeroOrNegative,
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
