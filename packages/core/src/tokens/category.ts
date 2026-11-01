import type { StyleProperty } from "@dsmith-dev/extractor-api";
import type { Token } from "../model/token.js";

/** 속성이 속한 토큰 카테고리. 순수 함수 — 규칙 엔진 그래프가 fs를 끌어오지 않게 load.ts에서 분리했다 */
export function tokenCategoryOf(property: StyleProperty): Token["category"] | null {
  switch (property) {
    case "color":
    case "background-color":
    case "border-color":
    case "fill":
    case "stroke":
      return "color";
    case "padding":
    case "margin":
    case "gap":
    case "width":
    case "height":
      return "spacing";
    case "border-radius":
      return "radius";
    case "font-size":
      return "font-size";
    default:
      return null;
  }
}
