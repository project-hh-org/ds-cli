import type { StyleUsage } from "@ds-cli/extractor-api";

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
    const px = Math.round(usage.normalized.px * 100) / 100;
    counts.set(px, (counts.get(px) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([px, count]) => ({ px, count, onScale: Math.abs(px) % SCALE_UNIT_PX === 0 }))
    .sort(
      (a, b) =>
        b.count - a.count || Number(b.onScale) - Number(a.onScale) || a.px - b.px,
    );
}
