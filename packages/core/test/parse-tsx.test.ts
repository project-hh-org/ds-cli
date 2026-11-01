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

  it(".ts 파일은 jsx 플러그인 없이 파싱해 타입 단언·제네릭 화살표 함수를 허용한다", () => {
    const ast = parseTsx(`const y = 1 as unknown;\nconst x = <number>y;\nconst id = <T>(v: T) => v;`, "a.ts");
    expect(ast.program.body).toHaveLength(3);
  });

  it(".tsx 파일은 계속 JSX를 파싱한다", () => {
    const ast = parseTsx(`const y = <div />;`, "a.tsx");
    expect(ast.program.body).toHaveLength(1);
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

describe("parseTsx: 파일 종류별 플러그인", () => {
  it(".d.ts는 ambient 문맥(dts)으로 파싱한다 — `const x: number;`는 .d.ts에서만 오류 없음", () => {
    expect(parseTsx("declare const y: 1;\nexport const x: number;", "a.d.ts").errors ?? []).toHaveLength(0);
    expect((parseTsx("export const x: number;", "a.ts").errors ?? []).length).toBeGreaterThan(0);
  });

  it(".mts/.cts는 jsx 없이 파싱한다(`<string>y` 단언)", () => {
    for (const f of ["a.mts", "a.cts"]) {
      expect(() => parseTsx("export const x = <string>y;", f)).not.toThrow();
      expect(parseTsx("export const x = <string>y;", f).errors ?? []).toHaveLength(0);
    }
  });
});
