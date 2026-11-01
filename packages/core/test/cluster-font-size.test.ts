import { describe, expect, it } from "vitest";
import type { StyleProperty, StyleSource, StyleUsage } from "@dsmith-dev/extractor-api";
import { clusterFontSizes } from "../src/cluster/font-size.js";

function fs(px: number, property: StyleProperty = "font-size", source: StyleSource = "hardcoded"): StyleUsage {
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

describe("clusterFontSizes", () => {
  it("정수 px로 반올림하고 ±1px 안은 가장 많이 쓰인 값에 묶는다", () => {
    const clusters = clusterFontSizes([12, 13, 13, 22, 13.4].map((px) => fs(px)));
    expect(clusters).toEqual([
      {
        px: 13,
        members: [
          { px: 13, count: 3 },
          { px: 12, count: 1 },
        ],
        total: 4,
      },
      { px: 22, members: [{ px: 22, count: 1 }], total: 1 },
    ]);
  });

  it("tolerancePx 0이면 12가 따로 남는다", () => {
    const clusters = clusterFontSizes([12, 13, 13].map((px) => fs(px)), { tolerancePx: 0 });
    expect(clusters.map((c) => c.px)).toEqual([13, 12]);
  });

  it("hardcoded font-size 길이만 입력으로 받는다", () => {
    const clusters = clusterFontSizes([fs(14, "padding"), fs(14, "font-size", "token"), fs(0), fs(-3)]);
    expect(clusters).toEqual([]);
  });
});
