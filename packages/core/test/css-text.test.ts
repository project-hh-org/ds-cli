import { describe, expect, it } from "vitest";
import { PLACEHOLDER, parseCssDeclarations } from "../src/parse/css-text.js";

function slices(text: string, offset = 0) {
  return parseCssDeclarations(text, offset).map((d) => [d.property, d.value, text.slice(d.start - offset, d.end - offset)]);
}

describe("parseCssDeclarations", () => {
  it("규칙 블록의 선언을 값 구간과 함께 돌려준다", () => {
    const decls = parseCssDeclarations("a{color:#fff;padding:12px}");
    expect(decls).toEqual([
      { property: "color", value: "#fff", start: 8, end: 12, dynamic: false },
      { property: "padding", value: "12px", start: 21, end: 25, dynamic: false },
    ]);
  });

  it("값 앞뒤 공백은 구간에서 제외한다", () => {
    const text = "a {\n  color :   red  ;\n}";
    const [decl] = parseCssDeclarations(text);
    expect(decl?.value).toBe("red");
    expect(text.slice(decl!.start, decl!.end)).toBe("red");
  });

  it("offset을 start/end에 더한다", () => {
    const [decl] = parseCssDeclarations("color: red", 100);
    expect(decl).toMatchObject({ property: "color", value: "red", start: 107, end: 110 });
  });

  it("중첩 블록(&:hover, @media)의 선언도 찾고 선택자·at-rule은 선언으로 보지 않는다", () => {
    const text = ".a { color: red; &:hover { color: blue } @media (min-width: 10px) { margin: 4px } }";
    expect(slices(text)).toEqual([
      ["color", "red", "red"],
      ["color", "blue", "blue"],
      ["margin", "4px", "4px"],
    ]);
  });

  it("a:hover 같은 선택자는 선언이 아니다", () => {
    expect(slices("a:hover, b:focus { color: red }")).toEqual([["color", "red", "red"]]);
  });

  it("주석 안의 선언은 무시하고 위치는 보존한다", () => {
    const text = "a { /* color:#000; */ color: #111; }";
    const decls = parseCssDeclarations(text);
    expect(decls).toHaveLength(1);
    expect(text.slice(decls[0]!.start, decls[0]!.end)).toBe("#111");
  });

  it("여러 줄 주석도 무시한다", () => {
    expect(slices("a {\n/* x: y;\n z: w; */\n color: red;\n}")).toEqual([["color", "red", "red"]]);
  });

  it("마지막 선언은 세미콜론 없이 끝나도 된다", () => {
    expect(slices("a{color:red}")).toEqual([["color", "red", "red"]]);
    expect(slices("color: red; padding: 4px")).toEqual([
      ["color", "red", "red"],
      ["padding", "4px", "4px"],
    ]);
  });

  it("템플릿 자리 표식이 있는 값은 dynamic이다", () => {
    const text = "padding: \u00000\u0000px 8px;";
    const [decl] = parseCssDeclarations(text);
    expect(decl).toMatchObject({ property: "padding", value: "\u00000\u0000px 8px", dynamic: true });
    expect(PLACEHOLDER.test(decl!.value)).toBe(true);
  });

  it("따옴표·괄호 안의 세미콜론은 값을 끝내지 않는다", () => {
    expect(
      slices(`a { background: url("a;b.png") red; content: ";"; width: calc(1px + 2px); }`),
    ).toEqual([
      ["background", `url("a;b.png") red`, `url("a;b.png") red`],
      ["content", `";"`, `";"`],
      ["width", "calc(1px + 2px)", "calc(1px + 2px)"],
    ]);
  });

  it("CSS 변수 정의와 scss 변수 선언도 선언이다", () => {
    expect(slices(":root { --brand: #3B82F6; }\n$gap: 8px;")).toEqual([
      ["--brand", "#3B82F6", "#3B82F6"],
      ["$gap", "8px", "8px"],
    ]);
  });

  it("scss 보간 #{} 의 중괄호는 블록으로 보지 않는다", () => {
    expect(slices("a { width: #{$w}px; color: red }")).toEqual([
      ["width", "#{$w}px", "#{$w}px"],
      ["color", "red", "red"],
    ]);
  });

  it("값이 비었거나 @규칙 문장은 선언이 아니다", () => {
    expect(slices("@import 'x.css'; @include mixin; a { color: ; margin: 1px }")).toEqual([
      ["margin", "1px", "1px"],
    ]);
  });

  it("빈 텍스트는 빈 배열", () => {
    expect(parseCssDeclarations("")).toEqual([]);
  });
});
