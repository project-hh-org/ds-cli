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

describe("usagesFromStyleObject", () => {
  it("리터럴 값은 값 노드 구간, 그 밖은 dynamic(패치 없음)", () => {
    const code = `x({ color: "#fff", padding: 12, margin: m })`;
    const ast = parseTsx(code, "a.ts");
    const stmt = ast.program.body[0]!;
    if (stmt.type !== "ExpressionStatement" || stmt.expression.type !== "CallExpression") throw new Error("shape");
    const obj = stmt.expression.arguments[0] as ObjectExpression;
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
