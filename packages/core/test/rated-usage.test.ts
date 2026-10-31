import { describe, expect, it } from "vitest";
import { isRatedUsage, type StyleUsage } from "../src/index.js";

function usage(over: Partial<StyleUsage>): StyleUsage {
  return {
    file: "a.tsx",
    line: 1,
    column: 0,
    property: "color",
    raw: "#fff",
    normalized: { kind: "color", hex: "#ffffff", l: 1, c: 0, h: 0 },
    source: "hardcoded",
    extractor: "inline-style",
    ...over,
  };
}

describe("isRatedUsage", () => {
  it("property가 other이면 평가 대상이 아니다", () => {
    expect(isRatedUsage(usage({ property: "other", raw: "flex", normalized: { kind: "unknown" } }))).toBe(false);
    expect(isRatedUsage(usage({ property: "other", source: "token", normalized: { kind: "unknown" } }))).toBe(false);
  });

  it("hardcoded인데 정규화되지 않은(unknown) 값은 평가 대상이 아니다", () => {
    expect(isRatedUsage(usage({ property: "height", raw: "100dvh", normalized: { kind: "unknown" } }))).toBe(false);
  });

  it("그 외(정규화된 hardcoded, token, tailwind-default)는 평가 대상이다", () => {
    expect(isRatedUsage(usage({}))).toBe(true);
    expect(isRatedUsage(usage({ property: "padding", normalized: { kind: "length", px: 4 } }))).toBe(true);
    expect(isRatedUsage(usage({ source: "token", normalized: { kind: "unknown" } }))).toBe(true);
    expect(isRatedUsage(usage({ source: "tailwind-default" }))).toBe(true);
  });
});
