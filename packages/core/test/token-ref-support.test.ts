import { describe, expect, it } from "vitest";
import { classifyDeclaration, lineLocator, parseCssDeclarations, parseTsx, usagesFromStyleObject } from "../src/index.js";
import type { ObjectExpression } from "@babel/types";

function classifyAll(code: string) {
  const lineOf = lineLocator(code);
  return parseCssDeclarations(code, 0, { lineComments: false }).map((decl) =>
    classifyDeclaration(decl, { file: "a.css", extractor: "x", code, lineOf }),
  );
}

function firstObject(code: string): ObjectExpression {
  const ast = parseTsx(`const o = ${code};`, "a.ts");
  const decl = ast.program.body[0];
  if (decl?.type !== "VariableDeclaration") throw new Error("no decl");
  const init = decl.declarations[0]?.init;
  if (init?.type !== "ObjectExpression") throw new Error("no object");
  return init;
}

describe("축약 속성 안의 var() 색 토큰", () => {
  it("border: 1px solid var(--c)는 border-color token으로 읽고 구간은 var() 하나", () => {
    const code = ".a{border:1px solid var(--c)}";
    const [r] = classifyAll(code);
    expect(r?.usage).toMatchObject({ property: "border-color", source: "token", raw: "var(--c)" });
    expect(r?.patch).toBeNull();
  });

  it("축약 속성이 아니면(width 등) 종전 규칙 그대로", () => {
    const [r] = classifyAll(".a{width:var(--w) 13px}");
    expect(r?.usage).toMatchObject({ property: "width", source: "hardcoded", raw: "13px" });
  });
});

describe("StyleObjectPatch.literal", () => {
  const code = `{ padding: "16px", margin: "var(--a) 13px", n: 4 }`;
  const run = () => usagesFromStyleObject(firstObject(code), { file: "a.ts", code: `const o = ${code};`, extractor: "x" });

  it("따옴표 안 내용 전체가 치환 구간일 때만 따옴표 포함 노드 구간을 준다", () => {
    const full = `const o = ${code};`;
    const [p, m, n] = run();
    const lit = p?.patch?.literal;
    expect(full.slice(lit?.start, lit?.end)).toBe(`"16px"`);
    expect(m?.patch?.literal).toBeUndefined();
    expect(n?.patch?.literal).toBeUndefined();
  });
});

describe("단축 속성 var() 분류 보강", () => {
  const one = (css: string) => classifyAll(css)[0];

  it("값 전체가 var()뿐인 background/border도 색 속성으로 읽는다", () => {
    expect(one(".a{background:var(--c)}")?.usage).toMatchObject({ property: "background-color", source: "token" });
    expect(one(".a{border:var(--c)}")?.usage).toMatchObject({ property: "border-color", source: "token" });
  });

  it("border/outline은 마지막 var()가 색이다", () => {
    expect(one(".a{border:var(--w) solid var(--c)}")?.usage).toMatchObject({
      property: "border-color",
      source: "token",
      raw: "var(--c)",
    });
    expect(one(".a{outline:var(--w) solid var(--c)}")?.usage).toMatchObject({ property: "border-color", raw: "var(--c)" });
  });

  it("다른 피연산자가 색 키워드·url이거나 길이·스타일이 아니면 색 토큰이 아니다", () => {
    for (const css of [
      ".a{border:var(--w) solid currentColor}",
      ".a{border:var(--w) solid inherit}",
      ".a{background:var(--img) no-repeat}",
      ".a{background:url(a.png) var(--c)}",
      ".a{outline:var(--w) solid transparent}",
    ]) {
      expect(one(css)?.usage, css).not.toMatchObject({ property: "border-color", source: "token" });
      expect(one(css)?.usage, css).not.toMatchObject({ property: "background-color", source: "token" });
    }
  });

  it("scss·less 변수 이름이 색 단어와 같아도 색으로 보지 않는다", () => {
    for (const css of [".a{border:1px solid $gray}", ".a{border:1px solid @gray}", ".a{border:1px solid theme.$gray}"]) {
      const usage = one(css)?.usage;
      expect(usage, css).not.toMatchObject({ source: "hardcoded", property: "border-color" });
    }
    expect(one(".a{border:1px solid $gray}")?.usage).toMatchObject({ property: "border-color", source: "token", raw: "$gray" });
  });

  it("#hex 앞 공백 없는 정규식 정리 후에도 hex 색은 읽는다", () => {
    expect(one(".a{border:1px solid #abc}")?.usage).toMatchObject({ property: "border-color", source: "hardcoded", raw: "#abc" });
  });
});
