import { describe, expect, it } from "vitest";
import { isSelfContainedType, renderScaffold } from "../src/scaffold.js";

describe("isSelfContainedType", () => {
  it.each([
    ['"a" | "b"', true],
    ["string", true],
    ["number | undefined", true],
    ["() => void", true],
    ["1 | 2 | 'x|y'", true],
    ["ReactNode", false],
    ["string[]", false],
    ["React.ReactNode | string", false],
    ["(e: Event) => void", false],
    ["", false],
  ])("%s → %s", (type, expected) => {
    expect(isSelfContainedType(type)).toBe(expected);
  });
});

describe("renderScaffold", () => {
  it("스냅샷: 결정 기준, 타입별 주석, 식별자가 아닌 prop 이름", () => {
    expect(
      renderScaffold({
        name: "Button",
        item: "Button",
        basis: "decided",
        from: "src/components/Button",
        props: [
          { name: "onClick" },
          { name: "children", type: "ReactNode" },
          { name: "variant", type: '"primary" | "secondary" | "danger"' },
          { name: "aria-label", type: "string", required: true },
        ],
        topUses: [
          { file: "app/page.tsx", count: 4 },
          { file: "app/orders/page.tsx", count: 2 },
        ],
        tokensRef: "design-system/tokens.css",
      }),
    ).toMatchInlineSnapshot(`
      "// dsmith init 스캐폴드 — Button (결정: src/components/Button)
      // 원 사용처 상위 2: app/page.tsx (4회), app/orders/page.tsx (2회)
      // TODO: 원 구현을 옮기고 하드코딩 값 대신 design-system/tokens.css 변수를 쓰세요. 이 파일은 dsmith가 다시 덮어쓰지 않습니다.

      export interface ButtonProps {
        "aria-label": string;
        children?: unknown; // 원 타입: ReactNode
        onClick?: unknown; // TODO: 타입 확인 (사용처에서만 관측)
        variant?: "primary" | "secondary" | "danger";
      }

      export function Button(props: ButtonProps) {
        // TODO: 구현
        return null;
      }
      "
    `);
  });

  it("추천 기준 첫 줄, props 없음", () => {
    const text = renderScaffold({
      name: "Card",
      item: "Card",
      basis: "recommended",
      from: "src/Card.tsx",
      props: [],
      topUses: [],
      tokensRef: "ds/tokens.css",
    });
    expect(text.split("\n")[0]).toBe("// dsmith init 스캐폴드 — Card (추천: src/Card.tsx, 결정 전)");
    expect(text).toContain("export interface CardProps {}");
  });
});
