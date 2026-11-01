import { describe, expect, it } from "vitest";
import { normalizeSpecifier } from "../src/index.js";
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
      { file: "src/App.tsx", line: 5, name: "Button", importedFrom: "src/ui/Button", module: "src/ui/Button", props: ["size"] },
      {
        file: "src/App.tsx",
        line: 6,
        name: "Dialog",
        importedFrom: "@radix-ui/react-dialog",
        module: "@radix-ui/react-dialog",
        props: [],
      },
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
        module: "@radix-ui/react-dialog",
        props: ["asChild"],
      },
    ]);
  });

  it("import가 없는 컴포넌트는 importedFrom이 null이고, 스프레드 속성은 무시하며 속성은 소스 순서를 따른다", () => {
    const result = usages(
      `const Local = () => <i />; const a = <Local b="1" {...rest} a={2} disabled />;`,
    );
    expect(result).toEqual([
      { file: "src/App.tsx", line: 1, name: "Local", importedFrom: null, module: "", props: ["b", "a", "disabled"] },
    ]);
  });

  it("소문자 요소와 fragment는 제외한다", () => {
    expect(usages(`const a = <><div /><span /></>;`)).toEqual([]);
  });

  it("@/ 별칭과 상대 경로로 import한 같은 모듈은 같은 importedFrom으로 해석된다", () => {
    const result = usages(
      [
        `import { Button } from "@/components/ui/button";`,
        `import { Button as B2 } from "../components/ui/button";`,
        `import { Card } from "~/components/ui/card.tsx";`,
        `const a = <><Button /><B2 /><Card /></>;`,
      ].join("\n"),
      "src/pages/x.tsx",
    );
    expect(result.map((u) => u.importedFrom)).toEqual([
      "src/components/ui/button",
      "src/components/ui/button",
      "src/components/ui/card",
    ]);
  });

  it("src/ 밖의 파일에서 쓴 @/ 별칭은 root 기준으로 해석한다", () => {
    const result = usages(`import { Nav } from "@/components/nav"; const a = <Nav />;`, "app/page.tsx");
    expect(result[0]?.importedFrom).toBe("components/nav");
    expect(result[0]?.module).toBe("components/nav");
  });
});

describe("extractComponentUsage — module", () => {
  const tsPaths = { baseUrl: "", paths: { "@/*": ["./src/*"], "components/*": ["./src/components/*"] } };

  it("패키지 서브패스 import와 루트 import는 같은 module(패키지명)이 된다. importedFrom은 그대로다", () => {
    const result = usages(
      [
        `import { Button } from "@mui/material/Button";`,
        `import { Button as B2 } from "@mui/material";`,
        `import Link from "next/link";`,
        `const a = <><Button /><B2 /><Link /></>;`,
      ].join("\n"),
    );
    expect(result.map((u) => [u.importedFrom, u.module])).toEqual([
      ["@mui/material/Button", "@mui/material"],
      ["@mui/material", "@mui/material"],
      ["next/link", "next"],
    ]);
  });

  it("tsconfig paths 별칭과 상대 경로로 import한 같은 모듈은 같은 module이 된다", () => {
    const alias = extractComponentUsage(
      "app/page.tsx",
      parseTsx(`import X from "@/components/X"; const a = <X />;`, "app/page.tsx"),
      tsPaths,
    );
    const relative = extractComponentUsage(
      "src/pages/a.tsx",
      parseTsx(`import X from "../components/X"; const a = <X />;`, "src/pages/a.tsx"),
      tsPaths,
    );
    expect(alias[0]?.module).toBe("src/components/X");
    expect(relative[0]?.module).toBe("src/components/X");
  });

  it("bare 형태의 paths 별칭도 root 상대 경로 module로 푼다", () => {
    const result = extractComponentUsage(
      "app/page.tsx",
      parseTsx(`import { Button } from "components/ui/button"; const a = <Button />;`, "app/page.tsx"),
      tsPaths,
    );
    expect(result[0]?.importedFrom).toBe("components/ui/button");
    expect(result[0]?.module).toBe("src/components/ui/button");
  });

  it("tsPaths가 없으면 기존 @/ 규칙으로 module을 정한다", () => {
    const result = usages(`import X from "@/components/X"; const a = <X />;`, "src/pages/a.tsx");
    expect(result[0]?.module).toBe("src/components/X");
  });

  it("상대 경로의 /index는 module에서 떼어 paths 결과와 같은 모양이 된다", () => {
    const result = usages(`import UI from "./ui/index.ts"; const a = <UI />;`, "src/App.tsx");
    expect(result[0]?.importedFrom).toBe("src/ui/index");
    expect(result[0]?.module).toBe("src/ui");
  });

  it("import 없는 컴포넌트는 module이 빈 문자열이고 importedFrom은 null이다", () => {
    const result = usages(`function Header() { return <div />; } const a = <Header />;`);
    expect(result[0]?.importedFrom).toBeNull();
    expect(result[0]?.module).toBe("");
  });
});

describe("normalizeSpecifier", () => {
  it("./, ../, @/, ~/, 선행 /, 선행 src/를 벗긴다", () => {
    expect(normalizeSpecifier("@/components/ui/button")).toBe("components/ui/button");
    expect(normalizeSpecifier("../../components/ui")).toBe("components/ui");
    expect(normalizeSpecifier("~/src/ui")).toBe("ui");
    expect(normalizeSpecifier("src/components/ui")).toBe("components/ui");
    expect(normalizeSpecifier("@acme/ui")).toBe("@acme/ui");
  });
});
