import type { ObjectExpression } from "@babel/types";
import { describe, expect, it } from "vitest";
import { classifyDeclaration, lineLocator, parseCssDeclarations, parseTsx, usagesFromStyleObject } from "../src/index.js";

/** `x({...})` 첫 인자 객체. */
function firstObject(code: string): ObjectExpression {
  const stmt = parseTsx(code, "a.ts").program.body[0]!;
  if (stmt.type !== "ExpressionStatement" || stmt.expression.type !== "CallExpression") throw new Error("shape");
  return stmt.expression.arguments[0] as ObjectExpression;
}

const camel = (k: string): string => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function viaText(prop: string, value: string) {
  const code = `.a { ${prop}: ${value}; }`;
  const [decl] = parseCssDeclarations(code);
  const r = classifyDeclaration(decl!, { file: "a.css", extractor: "x", code, lineOf: lineLocator(code) })!;
  return { usage: r.usage, patched: r.patch === null ? null : code.slice(r.patch.start, r.patch.end) };
}

function viaObject(prop: string, value: string) {
  const code = `x({ ${camel(prop)}: ${JSON.stringify(value)} })`;
  const [r] = usagesFromStyleObject(firstObject(code), { file: "a.ts", code, extractor: "x" });
  return { usage: r!.usage, patched: r!.patch === null ? null : code.slice(r!.patch.start, r!.patch.end) };
}

describe("객체 문법 문자열 값과 CSS 텍스트 선언의 분류 일치", () => {
  const cases: [string, string][] = [
    ["padding", "13px 8px"],
    ["border", "1px solid #000"],
    ["color", "#fff !important"],
    ["margin", "var(--x) 13px"],
    ["background", "url(a.png) #fff"],
    ["background", "#fff"],
    ["color", "var(--x)"],
    ["font-size", "1.5rem"],
    ["border-radius", "4px"],
    ["width", "calc(100% - 8px)"],
    ["padding-inline", "8px"],
    ["box-shadow", "0 1px 2px #000"],
  ];

  it.each(cases)("%s: %s", (prop, value) => {
    const text = viaText(prop, value);
    const object = viaObject(prop, value);
    const pick = (u: typeof text.usage) => ({ property: u.property, normalized: u.normalized, source: u.source, raw: u.raw });
    expect(pick(object.usage)).toEqual(pick(text.usage));
    // 치환 구간도 같은 부분 문자열(따옴표 안)을 가리킨다.
    expect(object.patched).toBe(text.patched);
  });

  it("문자열 값의 패치는 따옴표 안 하위 구간이고 quote: false, 숫자 값은 노드 전체에 quote: true", () => {
    const code = `x({ border: "1px solid #000", padding: 12 })`;
    const [border, padding] = usagesFromStyleObject(firstObject(code), { file: "a.ts", code, extractor: "x" });
    expect(border!.patch).toMatchObject({ quote: false });
    expect(code.slice(border!.patch!.start, border!.patch!.end)).toBe("#000");
    expect(border!.usage.column).toBe(code.indexOf("#000"));
    expect(padding!.patch).toMatchObject({ quote: true });
    expect(code.slice(padding!.patch!.start, padding!.patch!.end)).toBe("12");
  });
});
