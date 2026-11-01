import { describe, expect, it } from "vitest";
import { MUI_KEY_MAP, SPACING_PROPS, isPalettePath, isSpacingProp, spacingToPx } from "../src/index.js";

describe("spacingToPx", () => {
  it("MUI 기본 간격 단위(8px)를 곱한다", () => {
    expect(spacingToPx(2)).toBe(16);
    expect(spacingToPx(0.5)).toBe(4);
    expect(spacingToPx(-1)).toBe(-8);
  });

  it("단위를 바꿀 수 있다", () => {
    expect(spacingToPx(2, 4)).toBe(8);
  });
});

describe("isPalettePath", () => {
  it("팔레트 경로는 true", () => {
    expect(isPalettePath("primary.main")).toBe(true);
    expect(isPalettePath("grey.500")).toBe(true);
    expect(isPalettePath("text.secondary")).toBe(true);
    expect(isPalettePath("primary")).toBe(true);
    expect(isPalettePath("background.paper")).toBe(true);
  });

  it("색 리터럴·CSS 색 이름·임의 문자열은 false", () => {
    expect(isPalettePath("#fff")).toBe(false);
    expect(isPalettePath("red")).toBe(false);
    expect(isPalettePath("primary.main.extra!")).toBe(false);
    expect(isPalettePath("rgb(0,0,0)")).toBe(false);
  });
});

describe("MUI_KEY_MAP / SPACING_PROPS", () => {
  it("약어 키를 CSS 속성명으로 옮긴다", () => {
    expect(MUI_KEY_MAP.p).toBe("padding");
    expect(MUI_KEY_MAP.pt).toBe("padding-top");
    expect(MUI_KEY_MAP.mx).toBe("margin-inline");
    expect(MUI_KEY_MAP.bgcolor).toBe("background-color");
    expect(MUI_KEY_MAP.fontSize).toBe("font-size");
    expect(MUI_KEY_MAP.borderRadius).toBe("border-radius");
    expect(MUI_KEY_MAP.display).toBeUndefined();
  });

  it("간격 키 목록에 약어와 CSS 이름이 모두 있다", () => {
    for (const key of ["p", "px", "mb", "gap", "rowGap", "padding", "margin"]) {
      expect(SPACING_PROPS).toContain(key);
    }
  });
});

describe("isSpacingProp", () => {
  it("짧은 약어와 padding*/margin* 장문 키는 true", () => {
    for (const key of ["p", "mx", "gap", "rowGap", "paddingTop", "paddingX", "marginY", "paddingInlineStart", "marginBlockEnd", "padding", "margin"]) {
      expect(isSpacingProp(key)).toBe(true);
    }
  });

  it("그 밖의 키는 false", () => {
    for (const key of ["width", "fontSize", "borderRadius", "color", "pad", "display"]) {
      expect(isSpacingProp(key)).toBe(false);
    }
  });
});
