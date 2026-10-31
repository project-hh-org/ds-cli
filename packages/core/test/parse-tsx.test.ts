import { describe, expect, it } from "vitest";
import { parseTsx, traverse } from "../src/parse/tsx.js";

describe("parseTsx", () => {
  it("JSX와 TypeScript 구문을 파싱한다", () => {
    const ast = parseTsx(`const x: number = 1; const y = <div style={{ a: 1 }} />;`, "a.tsx");
    expect(ast.program.body).toHaveLength(2);
  });

  it("복구 가능한 오류(중복 선언)는 예외 없이 AST를 돌려준다", () => {
    const ast = parseTsx(`let a = 1; let a = 2;\nconst ok = <p />;`, "b.tsx");
    expect(ast.program.body).toHaveLength(3);
  });

  it("복구 불가능한 문법 오류는 예외를 던진다", () => {
    expect(() => parseTsx(`const = ;`, "c.tsx")).toThrow();
  });

  it("traverse는 호출 가능한 함수다", () => {
    const ast = parseTsx(`const y = <div />;`, "c.tsx");
    const names: string[] = [];
    traverse(ast, {
      JSXOpeningElement(path) {
        if (path.node.name.type === "JSXIdentifier") names.push(path.node.name.name);
      },
    });
    expect(names).toEqual(["div"]);
  });
});
