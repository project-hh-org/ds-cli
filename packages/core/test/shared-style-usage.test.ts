import type { ObjectExpression } from "@babel/types";
import { describe, expect, it } from "vitest";
import { classifyDeclaration, lineLocator, parseCssDeclarations, parseTsx, usagesFromStyleObject } from "../src/index.js";

describe("lineLocator", () => {
  it("오프셋을 줄(1부터)·열(0부터)로 바꾼다", () => {
    const lineOf = lineLocator("ab\ncd\n");
    expect(lineOf(0)).toEqual({ line: 1, column: 0 });
    expect(lineOf(4)).toEqual({ line: 2, column: 1 });
    expect(lineOf(6)).toEqual({ line: 3, column: 0 });
  });
});

describe("classifyDeclaration", () => {
  const classifyAll = (code: string) => {
    const lineOf = lineLocator(code);
    return parseCssDeclarations(code).map((d) =>
      classifyDeclaration(d, { file: "a.css", extractor: "x", code, lineOf }),
    );
  };

  it("하드코딩 길이는 첫 토큰 구간과 패치를 돌려준다", () => {
    const code = "a{padding:13px 8px}";
    const [r] = classifyAll(code);
    expect(r!.usage).toMatchObject({ property: "padding", raw: "13px", source: "hardcoded", extractor: "x" });
    expect(code.slice(r!.patch!.start, r!.patch!.end)).toBe("13px");
  });

  it("토큰 참조는 패치가 없고, !important만 남은 값은 null", () => {
    const [token, empty] = classifyAll("a{color:var(--c);margin:!important}");
    expect(token!.usage.source).toBe("token");
    expect(token!.patch).toBeNull();
    expect(empty).toBeNull();
  });

  it("dynamic 선언은 값 구간 전체를 raw로 쓰고 패치가 없다", () => {
    const code = "color: \u00000\u0000 !important";
    const decl = parseCssDeclarations(code)[0]!;
    const r = classifyDeclaration(decl, { file: "f", extractor: "x", code, lineOf: lineLocator(code) })!;
    expect(r.usage.source).toBe("dynamic");
    expect(r.usage.raw).toBe("\u00000\u0000 !important");
    expect(r.patch).toBeNull();
  });
});

/** `x({...})` 첫 인자 객체. */
function firstObject(code: string): ObjectExpression {
  const stmt = parseTsx(code, "a.ts").program.body[0]!;
  if (stmt.type !== "ExpressionStatement" || stmt.expression.type !== "CallExpression") throw new Error("shape");
  return stmt.expression.arguments[0] as ObjectExpression;
}

describe("usagesFromStyleObject", () => {
  const nestedCode = `x({ color: "#fff", "&:hover": { color: "#000" }, [bp.up("md")]: { padding: 8 } })`;

  it("기본은 중첩 객체를 재귀하지 않는다(키 하나가 dynamic)", () => {
    const results = usagesFromStyleObject(firstObject(nestedCode), { file: "a.ts", code: nestedCode, extractor: "x" });
    expect(results.map((r) => [r.usage.property, r.usage.source])).toEqual([
      ["color", "hardcoded"],
      ["other", "dynamic"],
    ]);
  });

  it("nested면 문자열·계산된 키의 객체 값을 재귀하고 키 자체는 usage를 내지 않는다", () => {
    const ctx = { file: "a.ts", code: nestedCode, extractor: "x", nested: true };
    const results = usagesFromStyleObject(firstObject(nestedCode), ctx);
    expect(results.map((r) => [r.usage.property, r.usage.raw, r.usage.source])).toEqual([
      ["color", "#fff", "hardcoded"],
      ["color", "#000", "hardcoded"],
      ["padding", "8", "hardcoded"],
    ]);
    expect(nestedCode.slice(results[1]!.patch!.start, results[1]!.patch!.end)).toBe(`"#000"`);
  });

  it("classify override는 지정한 키만 바꾸고 undefined면 기본 분류", () => {
    const code = `x({ color: "#fff", p: 2, margin: 4 })`;
    const results = usagesFromStyleObject(firstObject(code), {
      file: "a.ts",
      code,
      extractor: "x",
      classify: (key, _value, defaultClassify) => {
        if (key === "margin") return null;
        if (key !== "p") return undefined;
        const base = defaultClassify()!;
        return { ...base, usage: { ...base.usage, property: "padding", normalized: { kind: "length", px: 16 } } };
      },
    });
    expect(results.map((r) => [r.usage.property, r.usage.raw, r.usage.normalized])).toEqual([
      ["color", "#fff", { kind: "color", hex: "#ffffff", l: expect.any(Number), c: expect.any(Number), h: expect.any(Number) }],
      ["padding", "2", { kind: "length", px: 16 }],
    ]);
  });

  it("리터럴 값은 값 노드 구간, 그 밖은 dynamic(패치 없음)", () => {
    const code = `x({ color: "#fff", padding: 12, margin: m })`;
    const obj = firstObject(code);
    const results = usagesFromStyleObject(obj, { file: "a.ts", code, extractor: "x" });
    expect(results.map((r) => [r.usage.property, r.usage.source])).toEqual([
      ["color", "hardcoded"],
      ["padding", "hardcoded"],
      ["margin", "dynamic"],
    ]);
    expect(code.slice(results[0]!.patch!.start, results[0]!.patch!.end)).toBe(`"#fff"`);
    expect(results[2]!.patch).toBeNull();
  });
});
