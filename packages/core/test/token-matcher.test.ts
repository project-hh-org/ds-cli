import { describe, expect, it } from "vitest";
import type { Token } from "../src/model/token.js";
import { lengthDistance } from "../src/match/distance.js";
import { matchToken } from "../src/match/token-matcher.js";
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
