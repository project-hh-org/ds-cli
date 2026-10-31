import { describe, expect, it } from "vitest";
import type { StyleProperty, StyleSource, StyleUsage } from "@ds-cli/extractor-api";
import { clusterSpacing } from "../src/cluster/spacing-cluster.js";

function lengthUsage(
  px: number,
  property: StyleProperty = "padding",
  source: StyleSource = "hardcoded",
): StyleUsage {
  return {
    file: "a.tsx",
    line: 1,
    column: 1,
    property,
    raw: `${px}px`,
    normalized: { kind: "length", px },
    source,
    extractor: "test",
  };
}

describe("clusterSpacing", () => {
  it("px별로 집계하고 count 내림차순, 동률이면 스케일 안(onScale)을 먼저 정렬한다", () => {
    const usages = [12, 12, 16, 13].map((px) => lengthUsage(px));
    expect(clusterSpacing(usages)).toEqual([
      { px: 12, count: 2, onScale: true },
      { px: 16, count: 1, onScale: true },
      { px: 13, count: 1, onScale: false },
    ]);
  });

  it("padding·margin·gap만 간격으로 취급한다", () => {
    const usages = [
      lengthUsage(8, "padding"),
      lengthUsage(8, "margin"),
      lengthUsage(8, "gap"),
      lengthUsage(100, "width"),
      lengthUsage(100, "height"),
      lengthUsage(14, "font-size"),
      lengthUsage(6, "border-radius"),
    ];
    expect(clusterSpacing(usages)).toEqual([{ px: 8, count: 3, onScale: true }]);
  });

  it("hardcoded가 아닌 출처와 길이가 아닌 값은 제외한다", () => {
    const usages = [
      lengthUsage(8, "padding", "tailwind-default"),
      lengthUsage(8, "padding", "token"),
      lengthUsage(8, "padding", "dynamic"),
      { ...lengthUsage(8), normalized: { kind: "unknown" } as const },
    ];
    expect(clusterSpacing(usages)).toEqual([]);
  });

  it("0은 스케일 안, 음수는 절댓값 기준으로 판정하고 소수는 2자리로 반올림한다", () => {
    const usages = [lengthUsage(0), lengthUsage(-8), lengthUsage(-3), lengthUsage(4.001), lengthUsage(4)];
    expect(clusterSpacing(usages)).toEqual([
      { px: 4, count: 2, onScale: true },
      { px: -8, count: 1, onScale: true },
      { px: 0, count: 1, onScale: true },
      { px: -3, count: 1, onScale: false },
    ]);
  });

  it("반올림 결과가 -0이면 0으로 정규화한다", () => {
    const result = clusterSpacing([lengthUsage(-0.001), lengthUsage(0)]);
    expect(result).toHaveLength(1);
    expect(result[0]?.count).toBe(2);
    expect(Object.is(result[0]?.px, 0)).toBe(true);
  });

  it("count와 onScale이 같으면 px 오름차순이다", () => {
    const usages = [20, 8, 12].map((px) => lengthUsage(px));
    expect(clusterSpacing(usages).map((c) => c.px)).toEqual([8, 12, 20]);
  });
});
