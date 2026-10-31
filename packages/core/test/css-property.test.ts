import { describe, expect, it } from "vitest";
import {
  COLOR_PROPERTIES,
  LENGTH_PROPERTIES,
  cssPropertyToStyleProperty,
  isColorProperty,
  isLengthProperty,
  splitShorthandColor,
} from "../src/model/css-property.js";

describe("cssPropertyToStyleProperty", () => {
  it.each([
    ["backgroundColor", "background-color"],
    ["background-color", "background-color"],
    ["borderTopColor", "border-color"],
    ["border-top-left-radius", "border-radius"],
    ["paddingInline", "padding"],
    ["margin-top", "margin"],
    ["rowGap", "gap"],
    ["maxWidth", "width"],
    ["min-height", "height"],
    ["fontSize", "font-size"],
    ["fill", "fill"],
    ["background", "other"],
    ["opacity", "other"],
  ])("%s -> %s", (input, expected) => {
    expect(cssPropertyToStyleProperty(input)).toBe(expected);
  });
});

describe("isLengthProperty / isColorProperty", () => {
  it("길이·색 속성 집합과 일치한다", () => {
    expect([...LENGTH_PROPERTIES].every((p) => isLengthProperty(p))).toBe(true);
    expect([...COLOR_PROPERTIES].every((p) => isColorProperty(p))).toBe(true);
    expect(isLengthProperty("font-size")).toBe(true);
    expect(isLengthProperty("color")).toBe(false);
    expect(isColorProperty("stroke")).toBe(true);
    expect(isColorProperty("other")).toBe(false);
    expect(LENGTH_PROPERTIES.size).toBe(7);
    expect(COLOR_PROPERTIES.size).toBe(5);
  });
});

describe("splitShorthandColor", () => {
  it("border 축약에서 색 토큰의 위치를 돌려준다", () => {
    expect(splitShorthandColor("border", "1px solid #000")).toEqual({
      property: "border-color",
      colorText: "#000",
      start: 10,
      end: 14,
    });
  });

  it("background는 background-color로 승격한다", () => {
    expect(splitShorthandColor("background", "#fff url(x.png) no-repeat")).toEqual({
      property: "background-color",
      colorText: "#fff",
      start: 0,
      end: 4,
    });
  });

  it("rgb()/hsl() 함수와 이름 색을 인식하고 camelCase·방향별 border도 받는다", () => {
    expect(splitShorthandColor("borderTop", "2px dashed rgba(0, 0, 0, 0.5)")).toMatchObject({
      property: "border-color",
      colorText: "rgba(0, 0, 0, 0.5)",
      start: 11,
    });
    expect(splitShorthandColor("outline", "hsl(10 20% 30%) solid 1px")).toMatchObject({
      colorText: "hsl(10 20% 30%)",
    });
    expect(splitShorthandColor("border-left", "1px solid red")).toMatchObject({
      colorText: "red",
      start: 10,
      end: 13,
    });
  });

  it("첫 번째 색만 돌려준다", () => {
    expect(splitShorthandColor("background", "red, blue")).toMatchObject({ colorText: "red" });
  });

  it("색이 없으면 null", () => {
    expect(splitShorthandColor("background", "url(x.png)")).toBeNull();
    expect(splitShorthandColor("border", "1px solid")).toBeNull();
    expect(splitShorthandColor("border", "none")).toBeNull();
    expect(splitShorthandColor("border", "0 transparent")).toBeNull();
    expect(splitShorthandColor("background", "linear-gradient(red, blue)")).toBeNull();
    expect(splitShorthandColor("border", "1px solid var(--c)")).toBeNull();
  });

  it("url() 안의 색처럼 보이는 글자는 무시한다", () => {
    expect(splitShorthandColor("background", "url(red.png) #abc")).toMatchObject({ colorText: "#abc" });
  });

  it("축약 속성이 아니면 null", () => {
    expect(splitShorthandColor("color", "red")).toBeNull();
    expect(splitShorthandColor("border-radius", "4px")).toBeNull();
    expect(splitShorthandColor("background-image", "red")).toBeNull();
    expect(splitShorthandColor("border-color", "red")).toBeNull();
  });
});
