import { describe, expect, it } from "vitest";
import { clusterColors } from "../src/cluster/color-cluster.js";
import { colorTokenNames, uniqueNames } from "../src/cluster/names.js";
import { proposalTokens } from "../src/tokens/proposal.js";
import { localDate } from "../src/util/local-date.js";
import type { StyleUsage } from "@dsmith-dev/extractor-api";

describe("uniqueNames", () => {
  it("첫 등장은 그대로, 중복은 -2, -3 …", () => {
    expect(uniqueNames(["a", "b", "a", "a"])).toEqual(["a", "b", "a-2", "a-3"]);
  });

  it("이미 쓰인 이름은 건너뛴다", () => {
    expect(uniqueNames(["a", "a-2", "a"])).toEqual(["a", "a-2", "a-3"]);
  });
});

describe("colorTokenNames", () => {
  it("proposalTokens의 색 이름과 같다", () => {
    const hexes = ["#808080", "#7f7f7f", "#6e6e6e", "#3b82f6"];
    const usages: StyleUsage[] = hexes.map((hex, i) => {
      const n = parseInt(hex.slice(1, 3), 16) / 255;
      return {
        file: "a.tsx",
        line: i + 1,
        column: 1,
        property: "color",
        raw: hex,
        normalized: { kind: "color", hex, l: n, c: hex === "#3b82f6" ? 0.2 : 0, h: 260 },
        source: "hardcoded",
        extractor: "test",
      };
    });
    const clusters = clusterColors(usages);
    expect(colorTokenNames(clusters)).toEqual(
      proposalTokens(usages)
        .filter((t) => t.category === "color")
        .map((t) => t.name),
    );
  });
});

describe("localDate", () => {
  it("로컬 시간대 YYYY-MM-DD", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
