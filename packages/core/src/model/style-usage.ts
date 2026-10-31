import type { StyleUsage } from "@ds-cli/extractor-api";

export type { StyleProperty, StyleSource, StyleUsage } from "@ds-cli/extractor-api";

export type NormalizedColor = Extract<StyleUsage["normalized"], { kind: "color" }>;

/**
 * 하드코딩 비율·파일별 하드코딩 집계에 넣을 usage인지.
 * 디자인 속성이 아닌 값(`property: "other"`: display, opacity 등)과
 * 정규화되지 않은 hardcoded 값(`calc(...)`, `100dvh` 등)은 평가하지 않는다.
 */
export function isRatedUsage(u: StyleUsage): boolean {
  if (u.property === "other") return false;
  if (u.source === "hardcoded" && u.normalized.kind === "unknown") return false;
  return true;
}
