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

describe("parseCssDeclarations lineComments", () => {
  const opts = { lineComments: true };
  const names = (text: string, options?: { lineComments?: boolean }) =>
    parseCssDeclarations(text, 0, options).map((d) => [d.property, d.value]);

  it("// 줄 주석 뒤의 선언을 잃지 않는다", () => {
    expect(names("a{\n // note\n padding:1px;\n}", opts)).toEqual([["padding", "1px"]]);
  });

  it("선언 뒤의 // 주석이 다음 선언을 삼키지 않는다", () => {
    expect(names("a{ padding:1px; // x\n margin:2px;\n}", opts)).toEqual([
      ["padding", "1px"],
      ["margin", "2px"],
    ]);
  });

  it("// 주석 안의 짝 없는 괄호·선언은 무시한다", () => {
    expect(names("a{\n // oops ( color: red;\n margin:2px;\n}", opts)).toEqual([["margin", "2px"]]);
  });

  it("주석 처리로 위치가 밀리지 않는다", () => {
    const text = "a{ // c\n padding:1px; }";
    const [decl] = parseCssDeclarations(text, 0, opts);
    expect(text.slice(decl!.start, decl!.end)).toBe("1px");
  });

  it("url() 안과 따옴표 안의 //는 주석이 아니다", () => {
    expect(
      names(`a{ background: url(//cdn/x.png); content: "//x"; src: url(http://a/b); margin: 1px }`, opts),
    ).toEqual([
      ["background", "url(//cdn/x.png)"],
      ["content", `"//x"`],
      ["src", "url(http://a/b)"],
      ["margin", "1px"],
    ]);
  });

  it("옵션이 꺼져 있으면(기본) //를 주석으로 보지 않는다", () => {
    expect(names("a{ background: url(//cdn/x.png) }")).toEqual([["background", "url(//cdn/x.png)"]]);
    expect(names("a{ background: url(//cdn/x.png) }", { lineComments: false })).toEqual([
      ["background", "url(//cdn/x.png)"],
    ]);
  });
});

describe("parseCssDeclarations 선행 플레이스홀더", () => {
  it("세미콜론 없는 믹스인 문장이 다음 선언을 삼키지 않는다", () => {
    const text = "a{\n \u00000\u0000\n color: red;\n}";
    const decls = parseCssDeclarations(text);
    expect(decls.map((d) => [d.property, d.value])).toEqual([["color", "red"]]);
    expect(text.slice(decls[0]!.start, decls[0]!.end)).toBe("red");
  });

  it("세미콜론이 있는 믹스인 문장과 닫는 괄호 앞 단독 믹스인은 선언이 아니다", () => {
    expect(slices("a{ \u00000\u0000; color: red }")).toEqual([["color", "red", "red"]]);
    expect(slices("a{ \u00000\u0000\n}")).toEqual([]);
  });

  it("플레이스홀더 값을 가진 선언은 그대로 dynamic", () => {
    const [decl] = parseCssDeclarations("a{ \u00000\u0000 \u00001\u0000: red; margin: \u00002\u0000 }");
    expect(decl).toMatchObject({ property: "margin", dynamic: true });
  });
});
