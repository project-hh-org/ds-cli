import { describe, expect, it } from "vitest";
import type { StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
import { normalizeColor } from "../src/normalize/color.js";
import { clusterColors } from "../src/cluster/color-cluster.js";
import { colorTokenNames } from "../src/cluster/names.js";
import type { Token } from "../src/model/token.js";
import { buildTokenDraft, draftCoverage, draftToTokens } from "../src/tokens/draft.js";

function color(hex: string, property: StyleProperty = "color", file = "src/a.tsx"): StyleUsage {
  const normalized = normalizeColor(hex);
  if (normalized === null) throw new Error(hex);
  return { file, line: 1, column: 1, property, raw: hex, normalized, source: "hardcoded", extractor: "test" };
}

function len(px: number, property: StyleProperty, file = "src/a.tsx"): StyleUsage {
  return {
    file,
    line: 1,
    column: 1,
    property,
    raw: `${px}px`,
    normalized: { kind: "length", px },
    source: "hardcoded",
    extractor: "test",
  };
}

describe("buildTokenDraft", () => {
  it("근접한 파랑 3종은 색 토큰 1개로 합쳐 사용 수를 더한다", () => {
    const usages = [color("#3b82f6"), color("#3b82f6"), color("#3c83f7"), color("#3a81f5")];
    const draft = buildTokenDraft(usages);
    const colors = draft.tokens.filter((t) => t.category === "color");
    expect(colors).toHaveLength(1);
    const t = colors[0]!;
    expect(t.members).toHaveLength(3);
    expect(t.members[0]).toBe("#3b82f6");
    expect(t.usageCount).toBe(4);
    expect(t.group).toBe("color");
    expect(t.name).toBe(`color-${t.key}`);
    expect(t.chosen).toBeUndefined();
  });

  it("colorChoices는 클러스터 member일 때만 value·chosen에 반영한다", () => {
    const usages = [color("#3b82f6"), color("#3b82f6"), color("#3c83f7")];
    const key = colorTokenNames(clusterColors(usages))[0]!;
    const chosen = buildTokenDraft(usages, { colorChoices: { [key]: "#3c83f7" } }).tokens[0]!;
    expect(chosen.value).toBe("#3c83f7");
    expect(chosen.chosen).toBe("#3c83f7");
    expect(chosen.normalized).toMatchObject({ kind: "color", hex: "#3c83f7" });

    const ignored = buildTokenDraft(usages, { colorChoices: { [key]: "#ff0000" } }).tokens[0]!;
    expect(ignored.value).toBe("#3b82f6");
    expect(ignored.chosen).toBeUndefined();
  });

  it("간격은 4px 배수만 토큰이 되고 오프스케일은 가장 가까운 토큰으로 매핑한다", () => {
    const draft = buildTokenDraft([8, 8, 16, 13].map((px) => len(px, "padding")));
    const space = draft.tokens.filter((t) => t.group === "space");
    expect(space.map((t) => t.name)).toEqual(["space-2", "space-4"]);
    expect(space[0]).toMatchObject({ value: "8px", usageCount: 2, category: "spacing" });
    expect(draft.mappings).toEqual([
      { category: "spacing", px: 13, count: 1, token: "space-4", distancePx: 3 },
    ]);
  });

  it("모서리는 사다리 이름과 full을 쓴다", () => {
    const draft = buildTokenDraft([4, 4, 6, 9999].map((px) => len(px, "border-radius")));
    const radius = draft.tokens.filter((t) => t.group === "radius");
    expect(radius.map((t) => [t.name, t.value])).toEqual([
      ["radius-sm", "4px"],
      ["radius-md", "6px"],
      ["radius-full", "9999px"],
    ]);
    expect(radius[2]!.members).toEqual(["9999px"]);
  });

  it("글꼴 크기는 ±1px로 묶고 사다리에서 가까운 단계 이름을 쓴다", () => {
    const draft = buildTokenDraft([13, 13, 12, 22].map((px) => len(px, "font-size")));
    const text = draft.tokens.filter((t) => t.group === "text");
    expect(text.map((t) => [t.name, t.value])).toEqual([
      ["text-xs", "13px"],
      ["text-xl", "22px"],
    ]);
    expect(text[0]!.members).toEqual(["13px", "12px"]);
    expect(text[0]!.usageCount).toBe(3);
  });

  it("limits 밖 값은 mappings로 남는다", () => {
    const draft = buildTokenDraft([4, 4, 4, 8, 8, 12].map((px) => len(px, "padding")), {
      limits: { spacing: 2 },
    });
    expect(draft.tokens.map((t) => t.name)).toEqual(["space-1", "space-2"]);
    expect(draft.mappings).toEqual([
      { category: "spacing", px: 12, count: 1, token: "space-2", distancePx: 4 },
    ]);
  });

  it("그 카테고리 토큰이 없으면 mapping.token은 null", () => {
    const draft = buildTokenDraft([len(13, "padding")]);
    expect(draft.tokens).toEqual([]);
    expect(draft.mappings).toEqual([{ category: "spacing", px: 13, count: 1, token: null, distancePx: null }]);
  });

  it("excludeDirs 아래 usage는 입력에서 뺀다", () => {
    const usages = [
      color("#ff0000", "color", "design-system/tokens.ts"),
      color("#00ff00", "color", "src/a.tsx"),
      len(8, "padding", "design-system/x.tsx"),
    ];
    const draft = buildTokenDraft(usages, { excludeDirs: ["design-system"] });
    expect(draft.tokens.map((t) => t.category)).toEqual(["color"]);
    expect(draft.tokens[0]!.value).toBe("#00ff00");
  });

  it("모든 key에 W3C 금지 문자(. { })가 없다", () => {
    const usages = [
      ...[4, 8, 12, 13, 20, 100].map((px) => len(px, "padding")),
      ...[2, 4, 5, 6, 8, 9999].map((px) => len(px, "border-radius")),
      ...[10, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72].map((px) => len(px, "font-size")),
      color("#3b82f6"),
      color("#ef4444"),
    ];
    for (const t of buildTokenDraft(usages).tokens) {
      expect(t.key).toMatch(/^[^.{}$][^.{}]*$/);
    }
  });
});

describe("draftCoverage", () => {
  const tokens: Token[] = [
    { name: "--color-blue-400", value: "#3b82f6", normalized: normalizeColor("#3b82f6")!, category: "color" },
    { name: "--space-2", value: "8px", normalized: { kind: "length", px: 8 }, category: "spacing" },
  ];

  it("토큰으로 바꿀 수 있는 하드코딩 비율을 센다", () => {
    const usages = [
      color("#3b82f6"),
      color("#3c83f7"),
      color("#ef4444"),
      len(8, "padding"),
      len(13, "padding"),
      len(8, "width"),
    ];
    const cov = draftCoverage(usages, tokens);
    expect(cov.replaceable).toBe(3);
    expect(cov.total).toBe(5);
    expect(cov.rate).toBe(0.6);
    expect(cov.byCategory.spacing).toEqual({ replaceable: 1, total: 2 });
    expect(cov.byCategory.color).toEqual({ replaceable: 2, total: 3 });
  });

  it("total 0이면 rate는 null", () => {
    expect(draftCoverage([], tokens).rate).toBeNull();
  });

  it("excludeDirs를 반영한다", () => {
    const cov = draftCoverage([color("#3b82f6", "color", "ds/a.tsx"), color("#3b82f6")], tokens, {
      excludeDirs: ["ds"],
    });
    expect(cov.total).toBe(1);
  });
});

describe("draftToTokens", () => {
  it("name에 -- 접두사를 붙인다", () => {
    const draft = buildTokenDraft([len(8, "padding")]);
    expect(draftToTokens(draft)).toEqual([
      { name: "--space-2", value: "8px", normalized: { kind: "length", px: 8 }, category: "spacing" },
    ]);
  });
});
