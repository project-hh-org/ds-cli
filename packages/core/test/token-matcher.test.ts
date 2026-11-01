import { describe, expect, it } from "vitest";
import type { Token } from "../src/model/token.js";
import { lengthDistance } from "../src/match/distance.js";
import { matchToken, rankTokens } from "../src/match/token-matcher.js";
import { normalizeColor } from "../src/normalize/color.js";
import { normalizeLength } from "../src/normalize/length.js";

function colorToken(name: string, hex: string): Token {
  const normalized = normalizeColor(hex);
  if (normalized === null) throw new Error(`invalid color: ${hex}`);
  return { name, value: hex, normalized, category: "color" };
}

function spaceToken(name: string, px: number, category: Token["category"] = "spacing"): Token {
  return { name, value: `${px}px`, normalized: { kind: "length", px }, category };
}

function norm(hex: string) {
  const n = normalizeColor(hex);
  if (n === null) throw new Error(`invalid color: ${hex}`);
  return n;
}

describe("lengthDistance", () => {
  it("px 차이의 절댓값이다", () => {
    expect(lengthDistance(12, 16)).toBe(4);
    expect(lengthDistance(16, 12)).toBe(4);
  });
});

describe("matchToken", () => {
  const tokens = [colorToken("primary-500", "#3B82F6"), spaceToken("space-3", 12)];

  it("동일한 색은 exact다", () => {
    const m = matchToken(norm("#3B82F6"), tokens);
    expect(m?.token.name).toBe("primary-500");
    expect(m?.distance).toBe(0);
    expect(m?.confidence).toBe("exact");
  });

  it("거리 0.005 미만(#3C83F7, 약 0.003)은 exact로 본다", () => {
    const m = matchToken(norm("#3C83F7"), tokens);
    expect(m?.token.name).toBe("primary-500");
    expect(m?.distance).toBeGreaterThan(0);
    expect(m?.distance).toBeLessThan(0.005);
    expect(m?.confidence).toBe("exact");
  });

  it("거리 0.005 이상 0.03 미만(#3F86F8, 약 0.011)은 close다", () => {
    const m = matchToken(norm("#3F86F8"), tokens);
    expect(m?.token.name).toBe("primary-500");
    expect(m?.distance).toBeGreaterThanOrEqual(0.005);
    expect(m?.distance).toBeLessThan(0.03);
    expect(m?.confidence).toBe("close");
  });

  it("멀리 떨어진 색은 far다", () => {
    const m = matchToken(norm("#EF4444"), tokens);
    expect(m?.token.name).toBe("primary-500");
    expect(m?.confidence).toBe("far");
  });

  it("가장 가까운 색 토큰을 고른다", () => {
    const set = [colorToken("primary-500", "#3B82F6"), colorToken("danger-500", "#EF4444")];
    expect(matchToken(norm("#EE4343"), set)?.token.name).toBe("danger-500");
  });

  it("같은 길이는 exact다", () => {
    const m = matchToken({ kind: "length", px: 12 }, tokens);
    expect(m?.token.name).toBe("space-3");
    expect(m?.distance).toBe(0);
    expect(m?.confidence).toBe("exact");
  });

  it("2px 이내 차이는 close, 그보다 크면 far다", () => {
    expect(matchToken({ kind: "length", px: 13 }, tokens)?.confidence).toBe("close");
    expect(matchToken({ kind: "length", px: 14 }, tokens)?.confidence).toBe("close");
    expect(matchToken({ kind: "length", px: 15 }, tokens)?.confidence).toBe("far");
  });

  it("길이는 color 외 모든 카테고리의 길이 토큰과 비교한다", () => {
    const set = [spaceToken("radius-md", 6, "radius"), spaceToken("text-sm", 14, "font-size")];
    expect(matchToken({ kind: "length", px: 6 }, set)?.token.name).toBe("radius-md");
    expect(matchToken({ kind: "length", px: 14 }, set)?.token.name).toBe("text-sm");
  });

  it("색은 색 토큰만, 길이는 길이 토큰만 후보로 삼는다", () => {
    expect(matchToken(norm("#3B82F6"), [spaceToken("space-3", 12)])).toBeNull();
    expect(matchToken({ kind: "length", px: 12 }, [colorToken("primary-500", "#3B82F6")])).toBeNull();
  });

  it("unknown이거나 토큰이 없으면 null이다", () => {
    expect(matchToken({ kind: "unknown" }, tokens)).toBeNull();
    expect(matchToken(norm("#3B82F6"), [])).toBeNull();
  });

  it("normalizeLength 결과와 함께 쓸 수 있다", () => {
    const n = normalizeLength("12px");
    expect(n).not.toBeNull();
    expect(matchToken({ kind: "length", px: n as number }, tokens)?.confidence).toBe("exact");
  });
});

describe("rankTokens", () => {
  const colors = [
    colorToken("c1", "#3B82F6"),
    colorToken("c2", "#2563EB"),
    colorToken("c3", "#60A5FA"),
    colorToken("c4", "#EF4444"),
    colorToken("c5", "#10B981"),
  ];

  it("거리 오름차순으로 기본 4개를 돌려준다", () => {
    const ranked = rankTokens(norm("#3B82F6"), colors);
    expect(ranked).toHaveLength(4);
    expect(ranked[0]?.token.name).toBe("c1");
    expect(ranked[0]?.confidence).toBe("exact");
    const distances = ranked.map((r) => r.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("limit으로 개수를 정한다", () => {
    expect(rankTokens(norm("#3B82F6"), colors, { limit: 2 })).toHaveLength(2);
    expect(rankTokens(norm("#3B82F6"), colors, { limit: 10 })).toHaveLength(5);
  });

  it("거리가 같으면 입력 순서를 지킨다", () => {
    const tied = [spaceToken("a", 10), spaceToken("b", 10), spaceToken("c", 10)];
    expect(rankTokens({ kind: "length", px: 10 }, tied).map((r) => r.token.name)).toEqual(["a", "b", "c"]);
  });

  it("category를 주면 그 카테고리 토큰만 후보로 삼는다", () => {
    const set = [spaceToken("space-1", 6), spaceToken("radius-md", 6, "radius"), spaceToken("radius-lg", 8, "radius")];
    const ranked = rankTokens({ kind: "length", px: 6 }, set, { category: "radius" });
    expect(ranked.map((r) => r.token.name)).toEqual(["radius-md", "radius-lg"]);
  });

  it("unknown이거나 후보가 없으면 빈 배열이다", () => {
    expect(rankTokens({ kind: "unknown" }, colors)).toEqual([]);
    expect(rankTokens(norm("#3B82F6"), [])).toEqual([]);
  });

  it("matchToken은 rankTokens의 첫 항목이다", () => {
    expect(matchToken(norm("#EE4343"), colors)).toEqual(rankTokens(norm("#EE4343"), colors, { limit: 1 })[0]);
  });
});
