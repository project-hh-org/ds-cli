import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { JS_FILES, runConformance } from "@dsmith-dev/extractor-api";
import { styledExtractor } from "@dsmith-dev/extractor-styled";
import { describe, expect, it } from "vitest";
import { emotionExtractor } from "../src/index.js";

function extractAll(code: string, file = "a.tsx"): StyleUsage[] {
  return emotionExtractor.extract({ root: "/", file, code });
}

function summary(code: string): [string, string, string][] {
  return extractAll(code).map((u) => [u.property, u.raw, u.source]);
}

describe("emotionExtractor meta", () => {
  it("name·files·parses를 선언한다", () => {
    expect(emotionExtractor.name).toBe("emotion");
    expect(emotionExtractor.files).toEqual(JS_FILES);
    expect(emotionExtractor.parses).toBe("tsx");
  });

  it("appliesTo는 JS 파일에서 @emotion/·css={ 를 본다", () => {
    const ctx = (file: string, code: string) => ({ root: "/", file, code });
    expect(emotionExtractor.appliesTo(ctx("a.tsx", `import styled from "@emotion/styled"`))).toBe(true);
    expect(emotionExtractor.appliesTo(ctx("a.jsx", "<div css={{}} />"))).toBe(true);
    expect(emotionExtractor.appliesTo(ctx("a.tsx", "styled.div``"))).toBe(false);
    expect(emotionExtractor.appliesTo(ctx("a.css", "@emotion/"))).toBe(false);
  });
});

describe("emotionExtractor conformance", () => {
  it("계약을 지킨다", () => {
    const report = runConformance("emotion", () => emotionExtractor, [
      {
        file: "Prop.tsx",
        code: `const A = () => <div css={{ color: "#fff" }} />;`,
        expect: [{ property: "color", raw: "#fff", source: "hardcoded", extractor: "emotion" }],
      },
      {
        file: "Tag.tsx",
        code: `import { css } from "@emotion/react";\nconst a = css\`color:#fff\`;`,
        expect: [{ property: "color", raw: "#fff", source: "hardcoded", normalized: { kind: "color", hex: "#ffffff" } }],
      },
      {
        file: "Styled.tsx",
        code: `import styled from "@emotion/styled";\nconst B = styled.div\`padding: 13px 8px;\`;`,
        expect: [{ property: "padding", raw: "13px", normalized: { kind: "length", px: 13 } }],
      },
    ]);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(3);
  });
});

describe("emotionExtractor.extract", () => {
  it("@emotion/styled의 템플릿·객체 문법", () => {
    const code =
      `import styled from "@emotion/styled";\n` +
      "const A = styled.div`color: #111; margin: ${(p) => p.m}px;`;\n" +
      'const B = styled(Base)({ gap: "4px" }, (p) => ({ width: p.w }));';
    expect(summary(code)).toEqual([
      ["color", "#111", "hardcoded"],
      ["margin", "${(p) => p.m}px", "dynamic"],
      ["gap", "4px", "hardcoded"],
      ["width", "p.w", "dynamic"],
    ]);
  });

  it("@emotion/css의 css 태그와 @emotion/react의 css({...}) 호출", () => {
    expect(summary(`import { css } from "@emotion/css";\nconst a = css\`gap: 2px;\`;`)).toEqual([
      ["gap", "2px", "hardcoded"],
    ]);
    expect(summary(`import { css } from "@emotion/react";\nconst a = css({ color: "#000" });`)).toEqual([
      ["color", "#000", "hardcoded"],
    ]);
  });

  it("css prop: 객체, 함수, 배열, import된 css`` 는 한 번만 센다(배열 안 참조 base는 dynamic other)", () => {
    const code =
      `import { css } from "@emotion/react";\n` +
      "const a = <div css={css`color: #111;`} />;\n" +
      'const b = <div css={[base, css`color: #222;`, { color: "#333" }]} />;\n' +
      "const c = <div css={(t) => ({ color: t.fg })} />;";
    expect(summary(code)).toEqual([
      ["color", "#111", "hardcoded"],
      ["other", "base", "dynamic"],
      ["color", "#222", "hardcoded"],
      ["color", "#333", "hardcoded"],
      ["color", "t.fg", "dynamic"],
    ]);
  });

  it("css prop 참조(식별자·멤버·호출)는 dynamic other 한 건으로 센다", () => {
    const code =
      "const a = <div css={s} />;\n" +
      "const b = <div css={styles.x} />;\n" +
      "const c = <div css={make(1)} />;";
    const usages = extractAll(code);
    expect(usages.map((u) => [u.property, u.raw, u.source, u.normalized.kind, u.line, u.column])).toEqual([
      ["other", "s", "dynamic", "unknown", 1, 20],
      ["other", "styles.x", "dynamic", "unknown", 2, 20],
      ["other", "make(1)", "dynamic", "unknown", 3, 20],
    ]);
    expect(usages.every((u) => u.extractor === "emotion" && emotionExtractor.write(u, "x") === null)).toBe(true);
  });

  it("css prop의 import된 css({...}) 호출은 객체만 세고 참조로 세지 않는다", () => {
    const code = `import { css } from "@emotion/react";\nconst a = <div css={css({ color: "#111" })} />;`;
    expect(summary(code)).toEqual([["color", "#111", "hardcoded"]]);
  });

  it("css prop: 함수가 돌려주는 객체의 중첩 선택자를 재귀한다", () => {
    const code = 'const a = <div css={(t) => ({ "&:hover": { color: "#444" } })} />;';
    expect(summary(code)).toEqual([["color", "#444", "hardcoded"]]);
  });

  it("css prop: 미디어 쿼리 객체를 재귀하고 키는 usage를 내지 않는다", () => {
    const code = 'const a = <div css={{ "@media (min-width: 600px)": { padding: "8px" } }} />;';
    const usages = extractAll(code);
    expect(usages.map((u) => [u.property, u.raw, u.source])).toEqual([["padding", "8px", "hardcoded"]]);
    expect(usages.some((u) => u.property === "other" || u.source === "dynamic")).toBe(false);
  });

  it("css prop: 조건식은 두 분기를 모두 본다", () => {
    const code = 'const a = <div css={on ? { color: "#111" } : { color: "#222" }} />;';
    expect(summary(code)).toEqual([
      ["color", "#111", "hardcoded"],
      ["color", "#222", "hardcoded"],
    ]);
  });

  it("css prop: 배열 안의 논리식은 오른쪽을 본다(참조 base는 dynamic other)", () => {
    const code = 'const a = <div css={[base, on && { color: "#333" }, on && styles.x]} />;';
    expect(summary(code)).toEqual([
      ["other", "base", "dynamic"],
      ["color", "#333", "hardcoded"],
      ["other", "styles.x", "dynamic"],
    ]);
  });

  it("css prop: 배열 밖 논리식·조건식 안의 css`` 도 본다", () => {
    const code = "const a = <div css={on && css`color: #555;`} />;";
    expect(summary(code)).toEqual([["color", "#555", "hardcoded"]]);
  });

  it("styled-components 타입만 import한 파일의 css prop은 emotion이 맡는다", () => {
    const code = `import type { DefaultTheme } from "styled-components";\nconst a = <div css={{ color: "#fff" }} />;`;
    expect(summary(code)).toEqual([["color", "#fff", "hardcoded"]]);
  });

  it("css prop 안의 import 없는 css`` 도 본다", () => {
    expect(summary("const a = <div css={css`color: #fff;`} />;")).toEqual([["color", "#fff", "hardcoded"]]);
  });

  it("styled-components에서 import한 파일은 0건", () => {
    const code =
      `import styled, { css } from "styled-components";\n` +
      "const A = styled.div`color: #fff;`;\n" +
      "const m = css`gap: 1px;`;\n" +
      'const B = styled.div({ color: "#000" });\n' +
      'const c = <A css={{ color: "#123" }} />;';
    expect(extractAll(code)).toEqual([]);
  });

  it("@emotion/native의 styled도 맡는다", () => {
    const code = `import styled from "@emotion/native";\nconst V = styled.View({ padding: 8 });`;
    expect(summary(code)).toEqual([["padding", "8", "hardcoded"]]);
  });

  it("import 없는 styled는 맡지 않는다", () => {
    expect(extractAll("const A = styled.div`color: #fff;`;")).toEqual([]);
  });
});

describe("styled·emotion 귀속", () => {
  it("두 라이브러리를 함께 쓰는 파일에서 같은 값을 두 번 세지 않는다", () => {
    const code =
      `import scStyled from "styled-components";\n` +
      `import styled from "@emotion/styled";\n` +
      "const A = scStyled.div`color: #111;`;\n" +
      "const B = styled.div`color: #222;`;\n" +
      'const c = <B css={{ color: "#333" }} />;';
    const ctx = { root: "/", file: "a.tsx", code };
    expect(styledExtractor.extract(ctx).map((u) => u.raw)).toEqual(["#111"]);
    expect(emotionExtractor.extract(ctx).map((u) => u.raw)).toEqual(["#222", "#333"]);
  });
});
