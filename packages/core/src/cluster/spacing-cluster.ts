import type { StyleUsage } from "@dsmith/extractor-api";

export interface SpacingCandidate {
  px: number;
  count: number;
  onScale: boolean;
}

const SPACING_PROPERTIES = new Set<StyleUsage["property"]>(["padding", "margin", "gap"]);
const SCALE_UNIT_PX = 4;

export function clusterSpacing(usages: StyleUsage[]): SpacingCandidate[] {
  const counts = new Map<number, number>();
  for (const usage of usages) {
    if (usage.source !== "hardcoded" || usage.normalized.kind !== "length") continue;
    if (!SPACING_PROPERTIES.has(usage.property)) continue;
    // `+ 0`으로 -0을 0으로 명시 정규화한다 (Map 키 정규화에 기대지 않기 위함).
    const px = Math.round(usage.normalized.px * 100) / 100 + 0;
    counts.set(px, (counts.get(px) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([px, count]) => ({ px, count, onScale: Math.abs(px) % SCALE_UNIT_PX === 0 }))
    .sort(
      (a, b) =>
        b.count - a.count || Number(b.onScale) - Number(a.onScale) || a.px - b.px,
    );
}
