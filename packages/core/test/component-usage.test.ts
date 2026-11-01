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

  it("root 파일의 index import 네 형태(., ./index, ./, ./index.tsx)는 같은 module 'index'가 된다", () => {
    const result = usages(
      [
        `import A from ".";`,
        `import B from "./index";`,
        `import C from "./";`,
        `import D from "./index.tsx";`,
        `const x = <><A /><B /><C /><D /></>;`,
      ].join("\n"),
      "App.tsx",
    );
    expect(result.map((u) => u.module)).toEqual(["index", "index", "index", "index"]);
  });

  it("하위 디렉터리의 index import는 디렉터리 module이 된다(끝의 / 포함)", () => {
    const result = usages(
      [`import A from ".";`, `import B from "./";`, `import C from "./index";`, `const x = <><A /><B /><C /></>;`].join(
        "\n",
      ),
      "src/ui/Button.tsx",
    );
    expect(result.map((u) => u.module)).toEqual(["src/ui", "src/ui", "src/ui"]);
  });
});

describe("extractComponentUsage — baseUrl 전용(paths 없음)", () => {
  const tsPaths = { baseUrl: "src", paths: {} };
  const ctx = { baseUrlEntries: new Set(["components", "lib", "App"]) };

  function resolve(code: string, file = "src/pages/a.tsx") {
    return extractComponentUsage(file, parseTsx(code, file), tsPaths, ctx);
  }

  it("baseUrl 아래 최상위 항목으로 시작하는 bare import는 baseUrl 기준 경로 module이 된다", () => {
    const result = resolve(`import { Button } from "components/ui/button"; const a = <Button />;`);
    expect(result[0]?.importedFrom).toBe("components/ui/button");
    expect(result[0]?.module).toBe("src/components/ui/button");
  });

  it("같은 이름의 다른 경로(components/a/Header, components/b/Header)는 다른 module이다", () => {
    const result = resolve(
      [
        `import { Header } from "components/a/Header";`,
        `import { Header as H2 } from "components/b/Header";`,
        `const a = <><Header /><H2 /></>;`,
      ].join("\n"),
    );
    expect(result.map((u) => u.module)).toEqual(["src/components/a/Header", "src/components/b/Header"]);
  });

  it("baseUrl 아래에 없는 패키지는 패키지 규칙을 따른다", () => {
    const result = resolve(
      [`import { Box } from "@mui/material/Box";`, `import Link from "next/link";`, `const a = <><Box /><Link /></>;`].join(
        "\n",
      ),
    );
    expect(result.map((u) => u.module)).toEqual(["@mui/material", "next"]);
  });

  it("최상위 파일(App.tsx)도 확장자를 뗀 이름으로 일치한다", () => {
    expect(resolve(`import App from "App"; const a = <App />;`)[0]?.module).toBe("src/App");
  });

  it("baseUrlEntries를 넘기지 않으면 기존처럼 패키지 규칙이다", () => {
    const result = extractComponentUsage(
      "src/a.tsx",
      parseTsx(`import { Button } from "components/ui/button"; const a = <Button />;`, "src/a.tsx"),
      tsPaths,
    );
    expect(result[0]?.module).toBe("components");
  });
});

describe("extractComponentUsage — 모노레포 paths 별칭이 패키지를 가리킬 때", () => {
  const outside = {
    baseUrl: "",
    paths: { "@acme/ui": ["../../packages/ui/src/index.ts"], "@acme/ui/*": ["../../packages/ui/src/*"] },
  };
  const inside = { baseUrl: "", paths: { "@acme/ui": ["./vendor/ui/index.ts"], "@acme/ui/*": ["./vendor/ui/*"] } };
  const code = [
    `import { Button } from "@acme/ui";`,
    `import { Button as B2 } from "@acme/ui/button";`,
    `const a = <><Button /><B2 /></>;`,
  ].join("\n");

  it("paths 결과가 root 밖(../)이면 패키지명을 module로 써서 루트·서브패스 import가 합쳐진다", () => {
    const result = extractComponentUsage("src/a.tsx", parseTsx(code, "src/a.tsx"), outside);
    expect(result.map((u) => [u.importedFrom, u.module])).toEqual([
      ["@acme/ui", "@acme/ui"],
      ["@acme/ui/button", "@acme/ui"],
    ]);
  });

  it("패키지명이 root package.json 의존성이면 root 안을 가리켜도 패키지명을 쓴다", () => {
    const result = extractComponentUsage("src/a.tsx", parseTsx(code, "src/a.tsx"), inside, {
      dependencies: new Set(["@acme/ui"]),
    });
    expect(result.map((u) => u.module)).toEqual(["@acme/ui", "@acme/ui"]);
  });

  it("의존성이 아니고 root 안을 가리키면 paths 결과를 그대로 쓴다", () => {
    const result = extractComponentUsage("src/a.tsx", parseTsx(code, "src/a.tsx"), inside);
    expect(result.map((u) => u.module)).toEqual(["vendor/ui", "vendor/ui/button"]);
  });

  it("경로 형태(@/) 별칭은 root 밖을 가리켜도 paths 결과를 쓴다", () => {
    const shared = { baseUrl: "", paths: { "@/*": ["../shared/src/*"] } };
    const result = extractComponentUsage(
      "src/a.tsx",
      parseTsx(`import X from "@/x"; const a = <X />;`, "src/a.tsx"),
      shared,
    );
    expect(result[0]?.module).toBe("../shared/src/x");
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
