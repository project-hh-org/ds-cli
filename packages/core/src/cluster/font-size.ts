import type { StyleUsage } from "@dsmith-dev/extractor-api";

export interface FontSizeCluster {
  /** 대표값(정수 px) = 가장 많이 쓰인 값 */
  px: number;
  /** count desc → px asc */
  members: { px: number; count: number }[];
  total: number;
}

const DEFAULT_TOLERANCE_PX = 1;

/** 하드코딩 font-size를 정수 px로 반올림해 ±tolerancePx 안에서 묶는다. 결과는 total desc → px asc. */
export function clusterFontSizes(
  usages: StyleUsage[],
  opts: { tolerancePx?: number } = {},
): FontSizeCluster[] {
  const tolerance = opts.tolerancePx ?? DEFAULT_TOLERANCE_PX;

  const counts = new Map<number, number>();
  for (const usage of usages) {
    if (usage.source !== "hardcoded" || usage.property !== "font-size") continue;
    if (usage.normalized.kind !== "length" || !(usage.normalized.px > 0)) continue;
    const px = Math.round(usage.normalized.px);
    if (px <= 0) continue;
    counts.set(px, (counts.get(px) ?? 0) + 1);
  }

  const distinct = [...counts.entries()]
    .map(([px, count]) => ({ px, count }))
    .sort((a, b) => b.count - a.count || a.px - b.px);

  const clusters: FontSizeCluster[] = [];
  for (const entry of distinct) {
    const home = clusters.find((c) => Math.abs(c.px - entry.px) <= tolerance);
    if (home === undefined) clusters.push({ px: entry.px, members: [entry], total: entry.count });
    else {
      home.members.push(entry);
      home.total += entry.count;
    }
  }

  return clusters.sort((a, b) => b.total - a.total || a.px - b.px);
}
