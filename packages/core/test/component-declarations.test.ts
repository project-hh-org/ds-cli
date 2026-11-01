import { describe, expect, it } from "vitest";
import { componentDeclarations } from "../src/component/declarations.js";

describe("componentDeclarations", () => {
  it("최상위 대문자 선언의 줄 범위를 낸다 (모듈 상수 제외)", () => {
    const code = [
      "export function A(){", //1
      "  return null;", //2
      "}", //3
      "const variants = {}", //4
      "export const B = () => null", //5
      "class C {", //6
      "}", //7
      "export default function D(){}", //8
    ].join("\n");
    expect(componentDeclarations(code, "x.tsx")).toEqual([
      { name: "A", startLine: 1, endLine: 3 },
      { name: "B", startLine: 5, endLine: 5 },
      { name: "C", startLine: 6, endLine: 7 },
      { name: "D", startLine: 8, endLine: 8 },
    ]);
  });

  it("중첩 선언과 이름 없는 default는 낸다고 하지 않는다", () => {
    const code = "export default function(){}\nfunction outer(){ function Inner(){} }\n";
    expect(componentDeclarations(code, "x.tsx")).toEqual([]);
  });

  it("선언자가 여럿인 const는 선언자별 범위", () => {
    const code = "const A = () => 1,\n  B = () => 2;\n";
    expect(componentDeclarations(code, "x.tsx")).toEqual([
      { name: "A", startLine: 1, endLine: 1 },
      { name: "B", startLine: 2, endLine: 2 },
    ]);
  });
});

describe("componentDeclarations: 컴포넌트 같은 초기값만", () => {
  it("상수·styled 템플릿·객체/배열 리터럴은 제외한다", () => {
    const code = [
      "const SIZES = { sm: 1 };",
      "const LABEL = 'x';",
      "const Root = styled.button`color: red;`;",
      "const Wrap = styled(Root)({ color: 'red' });",
      "const Items = [1, 2];",
      "export const Card = () => null;",
      "export const Fancy = React.memo(function Fancy() { return null; });",
      "const Input = forwardRef((p, r) => null);",
      "const Klass = class {};",
    ].join("\n");
    expect(componentDeclarations(code, "x.tsx").map((d) => d.name)).toEqual(["Card", "Fancy", "Input", "Klass"]);
  });
});
