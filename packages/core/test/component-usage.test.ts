import { describe, expect, it } from "vitest";
import { extractComponentUsage } from "../src/index/component-usage.js";
import { parseTsx } from "../src/parse/tsx.js";

function usages(code: string, file = "src/App.tsx") {
  return extractComponentUsage(file, parseTsx(code, file));
}

describe("extractComponentUsage", () => {
  it("대문자 JSX 요소만 모으고 importedFrom을 해석한다(상대 경로는 root 기준, 패키지는 그대로)", () => {
    const result = usages(
      [
        `import { Button } from "./ui/Button";`,
        `import { Dialog } from "@radix-ui/react-dialog";`,
        `export const A = () => (`,
        `  <div>`,
        `    <Button size="sm" />`,
        `    <Dialog />`,
        `  </div>`,
        `);`,
      ].join("\n"),
    );
    expect(result).toEqual([
      { file: "src/App.tsx", line: 5, name: "Button", importedFrom: "src/ui/Button", props: ["size"] },
      { file: "src/App.tsx", line: 6, name: "Dialog", importedFrom: "@radix-ui/react-dialog", props: [] },
    ]);
  });

  it("상위 디렉터리 상대 경로를 정규화하고 확장자를 제거한다", () => {
    const result = usages(
      `import Card from "../shared/Card.tsx"; const a = <Card />;`,
      "src/pages/Home.tsx",
    );
    expect(result[0]?.importedFrom).toBe("src/shared/Card");
  });

  it("default·namespace·별칭 import를 로컬 이름으로 해석한다", () => {
    const result = usages(
      [
        `import Card from "./Card";`,
        `import * as UI from "./ui";`,
        `import { Button as Btn } from "./Button";`,
        `const a = (<><Card /><UI.Tabs /><Btn /></>);`,
      ].join("\n"),
    );
    expect(result.map((u) => [u.name, u.importedFrom])).toEqual([
      ["Card", "src/Card"],
      ["UI.Tabs", "src/ui"],
      ["Btn", "src/Button"],
    ]);
  });

  it("멤버 표현식 컴포넌트는 객체 식별자의 import로 해석한다", () => {
    const result = usages(
      `import { Dialog } from "@radix-ui/react-dialog"; const a = <Dialog.Trigger asChild />;`,
    );
    expect(result).toEqual([
      {
        file: "src/App.tsx",
        line: 1,
        name: "Dialog.Trigger",
        importedFrom: "@radix-ui/react-dialog",
        props: ["asChild"],
      },
    ]);
  });

  it("import가 없는 컴포넌트는 importedFrom이 null이고, 스프레드 속성은 무시하며 속성은 소스 순서를 따른다", () => {
    const result = usages(
      `const Local = () => <i />; const a = <Local b="1" {...rest} a={2} disabled />;`,
    );
    expect(result).toEqual([
      { file: "src/App.tsx", line: 1, name: "Local", importedFrom: null, props: ["b", "a", "disabled"] },
    ]);
  });

  it("소문자 요소와 fragment는 제외한다", () => {
    expect(usages(`const a = <><div /><span /></>;`)).toEqual([]);
  });
});
