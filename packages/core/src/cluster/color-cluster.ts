import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { colorDistance } from "../match/distance.js";
import type { NormalizedColor } from "../model/style-usage.js";

export interface ColorCluster {
  representative: NormalizedColor;
  members: { hex: string; count: number }[];
  total: number;
  suggestedName: string;
}

const DEFAULT_THRESHOLD = 0.03;
const ACHROMATIC_CHROMA = 0.03;

// 30° 폭 12구간. oklch hue 기준으로 red가 10°에서 시작한다(Tailwind red≈25°, blue≈260°, green≈150°).
const HUE_ORIGIN = 10;

const HUE_BUCKETS = [
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;

const LIGHTNESS_STEPS: readonly (readonly [number, number])[] = [
  [0.95, 50],
  [0.9, 100],
  [0.82, 200],
  [0.72, 300],
  [0.62, 400],
  [0.52, 500],
  [0.42, 600],
  [0.32, 700],
  [0.22, 800],
  [0.12, 900],
];

function suggestName(color: NormalizedColor): string {
  const hue =
    color.c < ACHROMATIC_CHROMA
      ? "gray"
      : (HUE_BUCKETS[Math.floor((((color.h - HUE_ORIGIN) % 360) + 360) % 360 / 30)] ?? "gray");
  const step = LIGHTNESS_STEPS.find(([min]) => color.l >= min)?.[1] ?? 950;
  return `${hue}-${step}`;
}

export function clusterColors(
  usages: StyleUsage[],
  opts: { threshold?: number } = {},
): ColorCluster[] {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  const counts = new Map<string, { color: NormalizedColor; count: number }>();
  for (const usage of usages) {
    if (usage.source !== "hardcoded" || usage.normalized.kind !== "color") continue;
    const entry = counts.get(usage.normalized.hex);
    if (entry === undefined) counts.set(usage.normalized.hex, { color: usage.normalized, count: 1 });
    else entry.count += 1;
  }

  const distinct = [...counts.values()].sort(
    (a, b) => b.count - a.count || (a.color.hex < b.color.hex ? -1 : 1),
  );

  const clusters: ColorCluster[] = [];
  for (const { color, count } of distinct) {
    const home = clusters.find((c) => colorDistance(c.representative, color) <= threshold);
    if (home === undefined) {
      clusters.push({
        representative: color,
        members: [{ hex: color.hex, count }],
        total: count,
        suggestedName: suggestName(color),
      });
    } else {
      home.members.push({ hex: color.hex, count });
      home.total += count;
    }
  }

  // members는 투입 순서가 이미 count 내림차순이다.
  return clusters.sort((a, b) => b.total - a.total);
}
