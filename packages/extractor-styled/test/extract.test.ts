import { parseTsx } from "@dsmith/core";
import type { StyleUsage } from "@dsmith/extractor-api";
import { JS_FILES, runConformance } from "@dsmith/extractor-api";
import type { TaggedTemplateExpression } from "@babel/types";
import { describe, expect, it } from "vitest";
import { declarationsFromTemplate, styledExtractor } from "../src/index.js";

const SC = `import styled, { css, createGlobalStyle, keyframes } from "styled-components";\n`;

function extractAll(code: string, file = "a.tsx"): StyleUsage[] {
  return styledExtractor.extract({ root: "/", file, code });
}

function summary(code: string): [string, string, string][] {
  return extractAll(code).map((u) => [u.property, u.raw, u.source]);
}

/** 코드 첫 TaggedTemplateExpression의 템플릿 리터럴. */
function firstTemplate(code: string) {
  const ast = parseTsx(code, "a.tsx");
  for (const stmt of ast.program.body) {
    if (stmt.type !== "VariableDeclaration") continue;
    const init = stmt.declarations[0]!.init as TaggedTemplateExpression;
    return init.quasi;
  }
  throw new Error("템플릿 없음");
}

describe("styledExtractor meta", () => {
  it("name·files·parses를 선언한다", () => {
    expect(styledExtractor.name).toBe("styled");
    expect(styledExtractor.files).toEqual(JS_FILES);
    expect(styledExtractor.parses).toBe("tsx");
  });

  it("appliesTo는 JS 파일에서 styled·createGlobalStyle·css` 를 본다", () => {
    const ctx = (file: string, code: string) => ({ root: "/", file, code });
    expect(styledExtractor.appliesTo(ctx("a.tsx", "styled.div``"))).toBe(true);
    expect(styledExtractor.appliesTo(ctx("a.ts", "createGlobalStyle``"))).toBe(true);
    expect(styledExtractor.appliesTo(ctx("a.js", "css`color:red`"))).toBe(true);
    expect(styledExtractor.appliesTo(ctx("a.tsx", "<div style={{}} />"))).toBe(false);
    expect(styledExtractor.appliesTo(ctx("a.css", "styled"))).toBe(false);
  });
});

describe("styledExtractor conformance", () => {
  it("계약을 지킨다", () => {
    const report = runConformance("styled", () => styledExtractor, [
      {
        file: "Button.tsx",
        code: `${SC}const B = styled.button\`color:#3B82F6;padding:13px 8px;\`;`,
        expect: [
          {
            property: "color",
            raw: "#3B82F6",
            source: "hardcoded",
            extractor: "styled",
            normalized: { kind: "color", hex: "#3b82f6" },
          },
          { property: "padding", raw: "13px", source: "hardcoded", normalized: { kind: "length", px: 13 } },
        ],
      },
      {
        file: "Dyn.tsx",
        code: `${SC}const D = styled.div\`color: \${(p) => p.c};\`;`,
        expect: [{ property: "color", source: "dynamic", normalized: { kind: "unknown" } }],
      },
      {
        file: "Obj.tsx",
        code: `${SC}const O = styled.div({ color: "#fff" });`,
        expect: [{ property: "color", raw: "#fff", source: "hardcoded", extractor: "styled" }],
      },
    ]);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(3);
  });
});

describe("declarationsFromTemplate", () => {
  it("값 구간을 원본 코드 오프셋으로 되돌린다", () => {
    const code = "const B = styled.div`\n  ${mixin}\n  color: #fff;\n  padding: ${p}px 8px;\n`;";
    const decls = declarationsFromTemplate(firstTemplate(code), code);
    expect(decls.map((d) => [d.property, d.dynamic, code.slice(d.codeStart, d.codeEnd)])).toEqual([
      ["color", false, "#fff"],
      ["padding", true, "${p}px 8px"],
    ]);
  });

  it("이스케이프가 있어도 오프셋이 어긋나지 않는다", () => {
    const code = 'const B = styled.div`content: "\\\\201C"; color: #000;`;';
    const decls = declarationsFromTemplate(firstTemplate(code), code);
    const color = decls.find((d) => d.property === "color")!;
    expect(code.slice(color.codeStart, color.codeEnd)).toBe("#000");
  });
});

describe("styledExtractor.extract — 템플릿", () => {
  it("`${m}px 8px` 는 dynamic 하나뿐이고 8px를 따로 세지 않는다", () => {
    const usages = extractAll(`${SC}const A = styled.div\`margin: \${m}px 8px;\`;`);
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ property: "margin", source: "dynamic", raw: "${m}px 8px" });
  });

  it("`${p => p.c}` 값은 dynamic", () => {
    expect(summary(`${SC}const A = styled.div\`color: \${(p) => p.c};\`;`)).toEqual([
      ["color", "${(p) => p.c}", "dynamic"],
    ]);
  });

  it("세미콜론 없는 믹스인 줄 뒤의 선언도 추출한다", () => {
    const code = `${SC}const A = styled.div\`\n  \${flex}\n  color:#fff;\n\`;`;
    expect(summary(code)).toEqual([["color", "#fff", "hardcoded"]]);
  });

  it("styled(Base), .attrs(...), styled(Base).attrs(...) 태그를 모두 본다", () => {
    const code =
      SC +
      "const A = styled(Base)`color: #111;`;\n" +
      "const B = styled.input.attrs({ type: 'text' })`color: #222;`;\n" +
      "const C = styled(Base).attrs((p) => ({ x: p.x }))`color: #333;`;\n" +
      "const D = styled.div<{ on: boolean }>`color: #444;`;";
    expect(extractAll(code).map((u) => u.raw)).toEqual(["#111", "#222", "#333", "#444"]);
  });

  it("styled-components의 css·createGlobalStyle은 보고 keyframes는 무시한다", () => {
    const code =
      SC +
      "const mix = css`gap: 4px;`;\n" +
      "const G = createGlobalStyle`body { background-color: #fafafa; }`;\n" +
      "const k = keyframes`from { width: 10px; } to { width: 20px; }`;";
    expect(summary(code)).toEqual([
      ["gap", "4px", "hardcoded"],
      ["background-color", "#fafafa", "hardcoded"],
    ]);
  });

  it("중첩 선택자·토큰·줄 주석을 처리한다", () => {
    const code =
      SC +
      "const A = styled.a`\n  // color: #999;\n  color: var(--fg);\n  &:hover { color: #fff; }\n`;";
    expect(summary(code)).toEqual([
      ["color", "var(--fg)", "token"],
      ["color", "#fff", "hardcoded"],
    ]);
  });

  it("템플릿 안의 css`` 는 바깥과 따로 한 번씩만 센다", () => {
    const code = SC + "const A = styled.div`color: #111; ${(p) => p.on && css`color: #222;`}`;";
    expect(extractAll(code).map((u) => u.raw).sort()).toEqual(["#111", "#222"]);
  });

  it("위치는 원본 코드에서 값의 시작이다", () => {
    const code = SC + "const A = styled.div`\n  padding: 4px;\n`;";
    const u = extractAll(code)[0]!;
    expect(u).toMatchObject({ line: 3, column: 11 });
  });
});

describe("styledExtractor.extract — 객체 문법", () => {
  it("styled.div({...}), styled.div(props => ({...})), styled(Base)({...})", () => {
    const code =
      SC +
      'const A = styled.div({ color: "#fff" });\n' +
      "const B = styled.div((p) => ({ padding: 4, margin: p.m }));\n" +
      'const C = styled(Base)({ gap: "8px" });\n' +
      "const D = styled.div((p) => { return { width: 10 }; });";
    expect(summary(code)).toEqual([
      ["color", "#fff", "hardcoded"],
      ["padding", "4", "hardcoded"],
      ["margin", "p.m", "dynamic"],
      ["gap", "8px", "hardcoded"],
      ["width", "10", "hardcoded"],
    ]);
  });

  it(".attrs({...}) 인자와 styled(Base) 인자는 스타일이 아니다", () => {
    const code = SC + "const A = styled.div.attrs({ color: '#fff' })`padding: 1px;`;\nconst B = styled({ color: '#000' });";
    expect(summary(code)).toEqual([["padding", "1px", "hardcoded"]]);
  });
});

describe("styledExtractor.extract — 귀속", () => {
  it("@emotion/styled에서 import한 파일은 0건", () => {
    const code = `import styled from "@emotion/styled";\nconst A = styled.div\`color: #fff;\`;\nconst B = styled.div({ color: "#000" });`;
    expect(extractAll(code)).toEqual([]);
  });

  it("@emotion/react의 css 태그는 보지 않는다", () => {
    const code = `import { css } from "@emotion/react";\nconst a = css\`color: #fff;\`;`;
    expect(extractAll(code)).toEqual([]);
  });

  it("import 없는 styled는 styled가 맡는다", () => {
    expect(summary("const A = styled.div`color: #fff;`;")).toEqual([["color", "#fff", "hardcoded"]]);
  });

  it("다른 패키지에서 import한 styled는 맡지 않는다", () => {
    const code = `import { styled } from "@mui/material/styles";\nconst A = styled("div")({ color: "#fff" });\nconst B = styled.div\`color: #000;\`;`;
    expect(extractAll(code)).toEqual([]);
  });

  it("styled-components/native에서 import한 styled도 맡는다", () => {
    const code = `import styled from "styled-components/native";\nconst V = styled.View\`padding: 8px;\`;`;
    expect(summary(code)).toEqual([["padding", "8px", "hardcoded"]]);
  });

  it("이름을 바꿔 import한 styled도 따라간다", () => {
    const code = `import sc from "styled-components";\nconst A = sc.div\`color: #fff;\`;`;
    expect(summary(code)).toEqual([["color", "#fff", "hardcoded"]]);
  });
});
