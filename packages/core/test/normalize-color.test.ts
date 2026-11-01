import { describe, expect, it } from "vitest";
import { isTranslucentColor, normalizeColor } from "../src/normalize/color.js";

describe("isTranslucentColor", () => {
  it.each([
    "rgba(17,24,39,0.5)",
    "rgba(17, 24, 39, .5)",
    "rgb(17 24 39 / 50%)",
    "#11182780",
    "#fff8",
    "#FFF8",
    "hsl(221 39% 11% / 0.5)",
    "hsla(221, 39%, 11%, 0.5)",
    "rgba(0,0,0,0)",
    "#0000",
    "transparent",
    "#00000000",
    "rgb(0 0 0 / 0%)",
  ])("%s는 반투명이다", (raw) => {
    expect(isTranslucentColor(raw)).toBe(true);
  });

  it.each(["#111827", "#fff", "#111827ff", "#ffff", "rgb(17, 24, 39)", "rgba(17,24,39,1)", "rgb(17 24 39 / 100%)", "blue", "not-a-color", ""])(
    "%j는 반투명이 아니다",
    (raw) => {
      expect(isTranslucentColor(raw)).toBe(false);
    },
  );
});

describe("normalizeColor", () => {
  it("hex를 소문자 hex와 oklch로 정규화한다", () => {
    const result = normalizeColor("#3B82F6");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("color");
    expect(result?.hex).toBe("#3b82f6");
    expect(result?.l).toBeCloseTo(0.623, 2);
    expect(result?.c).toBeCloseTo(0.188, 2);
    expect(result?.h).toBeCloseTo(259.8, 1);
  });

  it("rgb()는 같은 색의 hex와 동일하게 정규화된다", () => {
    expect(normalizeColor("rgb(59, 130, 246)")?.hex).toBe(normalizeColor("#3B82F6")?.hex);
  });

  it("hsl()을 정규화한다", () => {
    expect(normalizeColor("hsl(217.2, 91.2%, 59.8%)")?.hex).toBe("#3b82f6");
  });

  it("CSS 이름 색을 정규화한다", () => {
    expect(normalizeColor("blue")?.hex).toBe("#0000ff");
  });

  it("무채색의 h는 0으로 채운다", () => {
    expect(normalizeColor("#ffffff")?.h).toBe(0);
  });

  it.each(["transparent", "currentColor", "inherit", "initial", "unset", "CURRENTCOLOR"])(
    "%s는 null이다",
    (raw) => {
      expect(normalizeColor(raw)).toBeNull();
    },
  );

  it.each(["", "not-a-color", "12px"])("파싱할 수 없는 값 %j는 null이다", (raw) => {
    expect(normalizeColor(raw)).toBeNull();
  });
});
