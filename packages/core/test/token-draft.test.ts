import { describe, expect, it } from "vitest";
import type { StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
import { normalizeColor } from "../src/normalize/color.js";
import { clusterColors } from "../src/cluster/color-cluster.js";
import { colorTokenNames } from "../src/cluster/names.js";
import type { Token } from "../src/model/token.js";
import { bestReplacement, buildTokenDraft, draftCoverage, draftToTokens, replaceableToken } from "../src/tokens/draft.js";

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
      { category: "spacing", px: 13, count: 1, token: "space-4", distancePx: 3, scaleStep: 12, scaleName: "space-3" },
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
      { category: "spacing", px: 12, count: 1, token: "space-2", distancePx: 4, scaleStep: 12, scaleName: "space-3" },
    ]);
  });

  it("그 카테고리 토큰이 없으면 mapping.token은 null", () => {
    const draft = buildTokenDraft([len(13, "padding")]);
    expect(draft.tokens).toEqual([]);
    expect(draft.mappings).toEqual([{ category: "spacing", px: 13, count: 1, token: null, distancePx: null, scaleStep: 12, scaleName: "space-3" }]);
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

describe("buildTokenDraft 추론·사다리·대소문자", () => {
  it("오프스케일 합계가 3 이상이면 가장 가까운 4px 스텝을 inferred 토큰으로 넣는다", () => {
    const usages = [...Array(9).fill(18), 16, 16].map((px: number) => len(px, "padding"));
    const draft = buildTokenDraft(usages);
    const space = draft.tokens.filter((t) => t.group === "space");
    expect(space).toHaveLength(1);
    expect(space[0]).toMatchObject({ name: "space-4", value: "16px", usageCount: 2 });
    const usages2 = [...Array(9).fill(18)].map((px: number) => len(px, "padding"));
    const inferred = buildTokenDraft(usages2).tokens.find((t) => t.name === "space-4");
    expect(inferred).toMatchObject({ inferred: true, usageCount: 9, members: ["18px"], unit: "px" });
    expect(buildTokenDraft(usages2).mappings[0]).toMatchObject({ px: 18, token: "space-4", scaleStep: 16, scaleName: "space-4" });
  });

  it("합계가 3 미만이면 추론하지 않는다", () => {
    expect(buildTokenDraft([18, 18].map((px) => len(px, "padding"))).tokens).toEqual([]);
  });

  it("동률(6px)은 작은 스텝으로 간다", () => {
    expect(buildTokenDraft([len(6, "padding")]).mappings[0]).toMatchObject({ scaleStep: 4, scaleName: "space-1" });
  });

  it("확장된 사다리는 흔한 집합에서 접미사 없이 이름이 나온다", () => {
    const r = buildTokenDraft([2, 4, 8].map((px) => len(px, "border-radius"))).tokens.map((t) => t.name);
    expect(r).toEqual(["radius-2xs", "radius-sm", "radius-lg"]);
    const f = buildTokenDraft([10, 72].map((px) => len(px, "font-size"))).tokens.map((t) => t.name);
    expect(f).toEqual(["text-2xs", "text-7xl"]);
  });

  it("colorChoices hex 비교는 대소문자를 구분하지 않는다", () => {
    const usages = [color("#3b82f6"), color("#3b82f6"), color("#3c83f7")];
    const key = colorTokenNames(clusterColors(usages))[0]!;
    const t = buildTokenDraft(usages, { colorChoices: { [key]: "#3C83F7" } }).tokens[0]!;
    expect(t.value).toBe("#3c83f7");
    expect(t.chosen).toBe("#3c83f7");
    expect(t.unit).toBeUndefined();
  });
});

describe("draftCoverage", () => {
  it("999px 이상 모서리는 radius-full이 있으면 바꿀 수 있다", () => {
    const usages = [999, 9999, 4].map((px) => len(px, "border-radius"));
    const tokens = draftToTokens(buildTokenDraft(usages));
    const cov = draftCoverage(usages, tokens);
    expect(cov.byCategory.radius).toEqual({ replaceable: 3, total: 3 });
    const none = draftCoverage([len(999, "border-radius")], []);
    expect(none.replaceable).toBe(0);
  });

  it("0 이하 간격은 분모에서 빼고 zeroOrNegative로 센다", () => {
    const usages = [len(0, "margin"), len(-4, "margin"), len(8, "padding"), len(0, "border-radius")];
    const cov = draftCoverage(usages, [
      { name: "--space-2", value: "8px", normalized: { kind: "length", px: 8 }, category: "spacing" },
    ]);
    expect(cov.zeroOrNegative).toBe(2);
    expect(cov.byCategory.spacing).toEqual({ replaceable: 1, total: 1 });
    expect(cov.total).toBe(2);
  });

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

  it("바꿀 수 있는 수를 exact(같은 값·정확)와 close(근사)로 나눠 센다 — migrate 기본은 exact, --close가 close까지 (M3)", () => {
    const usages = [color("#3b82f6"), len(8, "padding"), len(7, "padding"), len(9, "margin"), len(13, "padding")];
    const cov = draftCoverage(usages, tokens);
    expect(cov.replaceable).toBe(4);
    expect(cov.byConfidence).toEqual({ exact: 2, close: 2 });
    expect(cov.byConfidence.exact + cov.byConfidence.close).toBe(cov.replaceable);
    expect(draftCoverage([], tokens).byConfidence).toEqual({ exact: 0, close: 0 });
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

describe("replaceableToken", () => {
  const tokens: Token[] = [
    { name: "--color-blue-400", value: "#3b82f6", normalized: normalizeColor("#3b82f6")!, category: "color" },
    { name: "--space-2", value: "8px", normalized: { kind: "length", px: 8 }, category: "spacing" },
    { name: "--radius-full", value: "9999px", normalized: { kind: "length", px: 9999 }, category: "radius" },
  ];

  it("정확히 같거나 가까운 값은 true, 먼 값은 false", () => {
    expect(replaceableToken(color("#3b82f6"), tokens)).toBe(true);
    expect(replaceableToken(color("#3c83f7"), tokens)).toBe(true);
    expect(replaceableToken(color("#ef4444"), tokens)).toBe(false);
    expect(replaceableToken(len(8, "padding"), tokens)).toBe(true);
    expect(replaceableToken(len(13, "padding"), tokens)).toBe(false);
  });

  it("스케일 밖 값이 먼 토큰에 대응돼도 true가 아니다", () => {
    const draft = buildTokenDraft([len(8, "padding"), len(8, "padding"), len(8, "padding"), len(30, "padding")]);
    const mapped = draft.mappings.find((m) => m.px === 30);
    expect(mapped?.token).not.toBeNull();
    expect(replaceableToken(len(30, "padding"), draftToTokens(draft))).toBe(false);
  });

  it("토큰 대상 속성이 아니면 false, 999px 이상 모서리는 radius-full이 있을 때만 true", () => {
    expect(replaceableToken(len(8, "width"), tokens)).toBe(false);
    expect(replaceableToken(len(999, "border-radius"), tokens)).toBe(true);
    expect(replaceableToken(len(999, "border-radius"), tokens.filter((t) => t.category !== "radius"))).toBe(false);
  });

  it("draftCoverage의 바꿀 수 있음은 replaceableToken과 같은 기준이다", () => {
    const usages = [color("#3b82f6"), color("#ef4444"), len(8, "padding"), len(13, "padding"), len(999, "border-radius")];
    const cov = draftCoverage(usages, tokens);
    expect(cov.replaceable).toBe(usages.filter((u) => replaceableToken(u, tokens)).length);
  });
});

describe("bestReplacement", () => {
  const tokens: Token[] = [
    { name: "--color-blue-400", value: "#3b82f6", normalized: normalizeColor("#3b82f6")!, category: "color" },
    { name: "--space-2", value: "8px", normalized: { kind: "length", px: 8 }, category: "spacing" },
    { name: "--radius-full", value: "9999px", normalized: { kind: "length", px: 9999 }, category: "radius" },
  ];

  it("고른 토큰과 확신도를 돌려준다", () => {
    expect(bestReplacement(color("#3b82f6"), tokens)).toMatchObject({ token: { name: "--color-blue-400" }, confidence: "exact" });
    expect(bestReplacement(color("#3c83f7"), tokens)).toMatchObject({ token: { name: "--color-blue-400" }, confidence: "exact" });
    expect(bestReplacement(color("#4a8af0"), tokens)).toMatchObject({ token: { name: "--color-blue-400" }, confidence: "close" });
    expect(bestReplacement(color("#ef4444"), tokens)).toBeNull();
    expect(bestReplacement(len(8, "padding"), tokens)).toMatchObject({ token: { name: "--space-2" }, confidence: "exact", distance: 0 });
    expect(bestReplacement(len(13, "padding"), tokens)).toBeNull();
    expect(bestReplacement(len(8, "width"), tokens)).toBeNull();
  });

  it("999px 이상 모서리는 radius-full 급 토큰으로 — px가 같으면 exact, 다르면 close", () => {
    expect(bestReplacement(len(999, "border-radius"), tokens)).toMatchObject({
      token: { name: "--radius-full" },
      confidence: "close",
      distance: 9000,
    });
    expect(bestReplacement(len(9999, "border-radius"), tokens)).toMatchObject({
      token: { name: "--radius-full" },
      confidence: "exact",
      distance: 0,
    });
    expect(bestReplacement(len(999, "border-radius"), tokens.filter((t) => t.category !== "radius"))).toBeNull();
  });

  it("999px 이상 모서리 폴백은 첫 토큰이 아니라 px가 가장 가까운 토큰", () => {
    const two: Token[] = [
      { name: "--radius-pill", value: "9999px", normalized: { kind: "length", px: 9999 }, category: "radius" },
      { name: "--radius-full", value: "1000px", normalized: { kind: "length", px: 1000 }, category: "radius" },
    ];
    expect(bestReplacement(len(999, "border-radius"), two)).toMatchObject({ token: { name: "--radius-full" }, distance: 1 });
    expect(bestReplacement(len(9999, "border-radius"), two)).toMatchObject({ token: { name: "--radius-pill" }, confidence: "exact" });
  });

  it("replaceableToken은 bestReplacement !== null과 항상 같다", () => {
    const usages = [color("#3b82f6"), color("#ef4444"), len(8, "padding"), len(13, "padding"), len(999, "border-radius"), len(8, "width")];
    for (const u of usages) expect(replaceableToken(u, tokens)).toBe(bestReplacement(u, tokens) !== null);
  });
});
