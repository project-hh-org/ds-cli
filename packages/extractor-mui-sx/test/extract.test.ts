import type { StyleUsage } from "@dsmith/extractor-api";
import { JS_FILES, runConformance } from "@dsmith/extractor-api";
import { describe, expect, it } from "vitest";
import { muiSxExtractor } from "../src/index.js";

const MUI = `import { Box } from "@mui/material";\n`;

function extractAll(code: string, file = "a.tsx"): StyleUsage[] {
  return muiSxExtractor.extract({ root: "/", file, code });
}

function summary(code: string): [string, string, string][] {
  return extractAll(code).map((u) => [u.property, u.raw, u.source]);
}

const JSX = (sx: string) => `${MUI}const A = () => <Box sx={${sx}} />;`;

describe("muiSxExtractor meta", () => {
  it("name·files·parses를 선언한다", () => {
    expect(muiSxExtractor.name).toBe("mui-sx");
    expect(muiSxExtractor.files).toEqual(JS_FILES);
    expect(muiSxExtractor.parses).toBe("tsx");
  });

  it("appliesTo는 sx= 가 있는 JS 파일만 본다", () => {
    const ctx = (file: string, code: string) => ({ root: "/", file, code });
    expect(muiSxExtractor.appliesTo(ctx("a.tsx", "<Box sx={{ p: 1 }} />"))).toBe(true);
    expect(muiSxExtractor.appliesTo(ctx("a.tsx", `import "@mui/material"; <Box sx={styles} />`))).toBe(true);
    expect(muiSxExtractor.appliesTo(ctx("a.tsx", `<div className="a" />`))).toBe(false);
    expect(muiSxExtractor.appliesTo(ctx("a.css", "sx={{"))).toBe(false);
  });
});

describe("muiSxExtractor conformance", () => {
  it("계약을 지킨다", () => {
    const report = runConformance("mui-sx", () => muiSxExtractor, [
      {
        file: "A.tsx",
        code: JSX(`{ p: 2, color: "#111", bgcolor: "primary.main", fontSize: "13px", borderRadius: 1 }`),
        expect: [
          { property: "padding", raw: "2", source: "token", normalized: { kind: "length", px: 16 }, extractor: "mui-sx" },
          { property: "color", raw: "#111", source: "hardcoded", normalized: { kind: "color", hex: "#111111" } },
          { property: "background-color", raw: "primary.main", source: "token", normalized: { kind: "unknown" } },
          { property: "font-size", raw: "13px", source: "hardcoded", normalized: { kind: "length", px: 13 } },
          { property: "border-radius", raw: "1", source: "token", normalized: { kind: "length", px: 4 } },
        ],
      },
      {
        file: "A.tsx",
        code: JSX(`[{ p: 1 }, cond && { m: 2 }]`),
        expect: [
          { property: "padding", source: "token", normalized: { kind: "length", px: 8 } },
          { property: "margin", source: "token", normalized: { kind: "length", px: 16 } },
        ],
      },
      {
        file: "A.tsx",
        code: JSX(`cond ? { px: 1 } : { px: 3 }`),
        expect: [
          { property: "padding", source: "token", normalized: { kind: "length", px: 8 } },
          { property: "padding", source: "token", normalized: { kind: "length", px: 24 } },
        ],
      },
      {
        file: "A.tsx",
        code: JSX(`{ gap: "12px", width: 240, zIndex: 2, opacity: 0.5 }`),
        expect: [
          { property: "gap", raw: "12px", source: "hardcoded", normalized: { kind: "length", px: 12 } },
          { property: "width", raw: "240", source: "hardcoded", normalized: { kind: "length", px: 240 } },
          { property: "other", raw: "2", source: "hardcoded", normalized: { kind: "unknown" } },
          { property: "other", raw: "0.5", source: "hardcoded", normalized: { kind: "unknown" } },
        ],
      },
    ]);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(4);
  });
});

describe("muiSxExtractor extract", () => {
  it("기본 객체: 정확히 5개의 usage", () => {
    const usages = extractAll(JSX(`{ p: 2, color: "#111", bgcolor: "primary.main", fontSize: "13px", borderRadius: 1 }`));
    expect(usages.map((u) => [u.property, u.raw, u.source])).toEqual([
      ["padding", "2", "token"],
      ["color", "#111", "hardcoded"],
      ["background-color", "primary.main", "token"],
      ["font-size", "13px", "hardcoded"],
      ["border-radius", "1", "token"],
    ]);
  });

  it("간격 숫자는 hardcoded가 아니라 token(×8), 음수·소수도 스케일을 따른다", () => {
    const usages = extractAll(JSX(`{ mt: -1, mx: 0.5, pt: 3, rowGap: 2, padding: 1 }`));
    expect(usages.map((u) => [u.property, u.raw, u.source, u.normalized])).toEqual([
      ["margin", "-1", "token", { kind: "length", px: -8 }],
      ["margin", "0.5", "token", { kind: "length", px: 4 }],
      ["padding", "3", "token", { kind: "length", px: 24 }],
      ["gap", "2", "token", { kind: "length", px: 16 }],
      ["padding", "1", "token", { kind: "length", px: 8 }],
    ]);
  });

  it("장문 padding*/margin* 키의 숫자도 테마 간격 token", () => {
    const usages = extractAll(
      JSX(`{ paddingTop: 2, marginX: 1, paddingY: 2, marginInline: 1, paddingInlineStart: 1, marginBlockEnd: 3 }`),
    );
    expect(usages.map((u) => [u.property, u.raw, u.source, u.normalized])).toEqual([
      ["padding", "2", "token", { kind: "length", px: 16 }],
      ["margin", "1", "token", { kind: "length", px: 8 }],
      ["padding", "2", "token", { kind: "length", px: 16 }],
      ["margin", "1", "token", { kind: "length", px: 8 }],
      ["padding", "1", "token", { kind: "length", px: 8 }],
      ["margin", "3", "token", { kind: "length", px: 24 }],
    ]);
  });

  it("장문 키라도 문자열 값은 hardcoded", () => {
    const usages = extractAll(JSX(`{ paddingTop: "16px" }`));
    expect(usages.map((u) => [u.property, u.source, u.normalized])).toEqual([
      ["padding", "hardcoded", { kind: "length", px: 16 }],
    ]);
  });

  it("크기 숫자 0 초과 1 이하는 비율이라 hardcoded unknown, 그 밖은 px 길이", () => {
    const usages = extractAll(JSX(`{ width: 1, height: 0.5, minWidth: 0.25, maxWidth: 240, width: 0, height: 1.5 }`));
    expect(usages.map((u) => [u.property, u.raw, u.source, u.normalized])).toEqual([
      ["width", "1", "hardcoded", { kind: "unknown" }],
      ["height", "0.5", "hardcoded", { kind: "unknown" }],
      ["width", "0.25", "hardcoded", { kind: "unknown" }],
      ["width", "240", "hardcoded", { kind: "length", px: 240 }],
      ["width", "0", "hardcoded", { kind: "length", px: 0 }],
      ["height", "1.5", "hardcoded", { kind: "length", px: 1.5 }],
    ]);
  });

  it("비율 크기도 write 패치는 유지된다", () => {
    const code = JSX(`{ width: 0.5 }`);
    const [u] = muiSxExtractor.extract({ root: "/", file: "a.tsx", code });
    expect(muiSxExtractor.write(u!, "var(--w)")).not.toBeNull();
  });

  it("간격 키라도 문자열 값은 hardcoded", () => {
    expect(summary(JSX(`{ p: "12px", m: "auto" }`))).toEqual([
      ["padding", "12px", "hardcoded"],
      ["margin", "auto", "hardcoded"],
    ]);
  });

  it("borderRadius 숫자는 token(×4), 문자열은 hardcoded", () => {
    const usages = extractAll(JSX(`{ borderRadius: 2 }`)).concat(extractAll(JSX(`{ borderRadius: "4px" }`)));
    expect(usages.map((u) => [u.source, u.normalized])).toEqual([
      ["token", { kind: "length", px: 8 }],
      ["hardcoded", { kind: "length", px: 4 }],
    ]);
  });

  it("팔레트 경로는 token, CSS 색은 hardcoded, bare grey는 CSS 색 이름이라 hardcoded", () => {
    expect(summary(JSX(`{ color: "text.secondary", borderColor: "grey.300", backgroundColor: "#fff", bgcolor: "grey" }`))).toEqual([
      ["color", "text.secondary", "token"],
      ["border-color", "grey.300", "token"],
      ["background-color", "#fff", "hardcoded"],
      ["background-color", "grey", "hardcoded"],
    ]);
  });

  it("var(--x) 문자열은 token", () => {
    expect(summary(JSX(`{ color: "var(--c)", p: "var(--s)" }`))).toEqual([
      ["color", "var(--c)", "token"],
      ["padding", "var(--s)", "token"],
    ]);
  });

  it("중첩 선택자·브레이크포인트 키는 usage를 내지 않고 값만 센다", () => {
    const code = JSX(`{ "&:hover": { color: "#fff" }, [theme.breakpoints.up("md")]: { m: 1 } }`);
    expect(summary(code)).toEqual([
      ["color", "#fff", "hardcoded"],
      ["margin", "1", "token"],
    ]);
  });

  it("브레이크포인트 키 반응형 값은 부모 키 규칙으로 센다", () => {
    const code = JSX(`{ p: { xs: 1, md: 2 }, display: { xs: "none", md: "block" }, "& .a": { fontSize: { sm: 12 } } }`);
    expect(summary(code)).toEqual([
      ["padding", "1", "token"],
      ["padding", "2", "token"],
      ["other", "none", "hardcoded"],
      ["other", "block", "hardcoded"],
      ["font-size", "12", "hardcoded"],
    ]);
  });

  it("함수 sx는 dynamic 하나, 내부 padding은 세지 않는다", () => {
    const usages = extractAll(JSX(`(t) => ({ p: 1 })`));
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ source: "dynamic", property: "other", raw: "(t) => ({ p: 1 })", extractor: "mui-sx" });
  });

  it("배열 안의 함수도 dynamic 하나", () => {
    const usages = extractAll(JSX(`[{ p: 1 }, (t) => ({ m: 1 }), ...rest]`));
    expect(usages.map((u) => [u.property, u.source])).toEqual([
      ["padding", "token"],
      ["other", "dynamic"],
    ]);
  });

  it("논리식은 오른쪽만 본다", () => {
    expect(summary(JSX(`cond && { p: 1 }`))).toEqual([["padding", "1", "token"]]);
  });

  it("리터럴이 아닌 값은 dynamic", () => {
    expect(summary(JSX(`{ color: theme.palette.text.primary, p: space, m: \`\${a}px\`, width: t => t.x }`))).toEqual([
      ["color", "theme.palette.text.primary", "dynamic"],
      ["padding", "space", "dynamic"],
      ["margin", "`${a}px`", "dynamic"],
      ["width", "t => t.x", "dynamic"],
    ]);
  });

  it("스프레드·계산된 키 스칼라·메서드는 건너뛴다", () => {
    expect(summary(JSX(`{ ...base, [key]: 1, m() {}, p: 1 }`))).toEqual([["padding", "1", "token"]]);
  });

  it("sx가 식별자·함수 호출이면 usage 없음", () => {
    expect(extractAll(JSX(`styles`))).toEqual([]);
    expect(extractAll(JSX(`makeSx(1)`))).toEqual([]);
  });

  it("style·css prop은 건드리지 않는다", () => {
    expect(extractAll(`${MUI}const A = () => <Box style={{ p: 2, color: "#fff" }} css={{ color: "#000" }} />;`)).toEqual([]);
  });

  it("sx와 style이 함께 있으면 sx만 센다", () => {
    expect(summary(`${MUI}const A = () => <Box sx={{ p: 1 }} style={{ color: "#fff" }} />;`)).toEqual([
      ["padding", "1", "token"],
    ]);
  });

  it("위치(line·column)는 값 기준이다(문자열은 따옴표 안 값)", () => {
    const [u] = extractAll(`${MUI}\nconst A = () => (\n  <Box sx={{ color: "#fff" }} />\n);`);
    expect(u).toMatchObject({ file: "a.tsx", line: 4, column: 21 });
  });
});
