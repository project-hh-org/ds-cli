import type { StyleUsage, WritePatch } from "@dsmith/extractor-api";
import { describe, expect, it } from "vitest";
import { muiSxExtractor } from "../src/index.js";

const JSX = (sx: string) => `import { Box } from "@mui/material";\nconst A = () => <Box sx={${sx}} />;`;

function find(code: string, raw: string): StyleUsage {
  const usage = muiSxExtractor.extract({ root: "/", file: "s/a.tsx", code }).find((u) => u.raw === raw);
  if (usage === undefined) throw new Error(`usage 없음: ${raw}`);
  return usage;
}

function apply(code: string, patch: WritePatch): string {
  return code.slice(0, patch.start) + patch.replacement + code.slice(patch.end);
}

describe("muiSxExtractor.write", () => {
  it("문자열 리터럴은 따옴표 안 값 구간을 tokenRef 그대로 치환한다", () => {
    const code = JSX(`{ color: "#111", p: 2 }`);
    const patch = muiSxExtractor.write(find(code, "#111"), "var(--c)")!;
    expect(patch.file).toBe("s/a.tsx");
    expect(code.slice(patch.start, patch.end)).toBe("#111");
    expect(apply(code, patch)).toBe(JSX(`{ color: "var(--c)", p: 2 }`));
  });

  it("여러 값 문자열은 첫 하드코딩 토큰만 치환한다", () => {
    const code = JSX(`{ margin: "var(--m) 13px" }`);
    const usage = find(code, "13px");
    expect(usage).toMatchObject({ property: "margin", source: "hardcoded", normalized: { kind: "length", px: 13 } });
    expect(apply(code, muiSxExtractor.write(usage, "var(--s)")!)).toBe(JSX(`{ margin: "var(--m) var(--s)" }`));
  });

  it("숫자 리터럴도 문자열 값으로 치환한다", () => {
    const code = JSX(`{ fontSize: 13, width: -4 }`);
    const font = muiSxExtractor.write(find(code, "13"), "var(--fs)")!;
    expect(code.slice(font.start, font.end)).toBe("13");
    expect(apply(code, font)).toBe(JSX(`{ fontSize: "var(--fs)", width: -4 }`));
    const width = muiSxExtractor.write(find(code, "-4"), "var(--w)")!;
    expect(apply(code, width)).toBe(JSX(`{ fontSize: 13, width: "var(--w)" }`));
  });

  it("별칭 키·중첩 값·배열 원소도 원래 위치를 치환한다", () => {
    const code = JSX(`[{ bgcolor: "#fff" }, { "&:hover": { color: "#000" } }]`);
    const bg = muiSxExtractor.write(find(code, "#fff"), "var(--bg)")!;
    expect(apply(code, bg)).toBe(JSX(`[{ bgcolor: "var(--bg)" }, { "&:hover": { color: "#000" } }]`));
    const hover = muiSxExtractor.write(find(code, "#000"), "var(--fg)")!;
    expect(apply(code, hover)).toBe(JSX(`[{ bgcolor: "#fff" }, { "&:hover": { color: "var(--fg)" } }]`));
  });

  it("테마 스케일 token·dynamic usage는 null", () => {
    const code = JSX(`{ p: 2, borderRadius: 1, bgcolor: "primary.main", color: theme.x }`);
    const usages = muiSxExtractor.extract({ root: "/", file: "a.tsx", code });
    expect(usages).toHaveLength(4);
    expect(usages.map((u) => muiSxExtractor.write(u, "x"))).toEqual([null, null, null, null]);
  });

  it("함수 sx(dynamic)는 null, 남이 만든 usage도 null", () => {
    const code = JSX(`(t) => ({ p: 1 })`);
    const [dyn] = muiSxExtractor.extract({ root: "/", file: "a.tsx", code });
    expect(muiSxExtractor.write(dyn!, "x")).toBeNull();
    const foreign: StyleUsage = { ...dyn!, source: "hardcoded" };
    expect(muiSxExtractor.write(foreign, "x")).toBeNull();
  });
});

describe("muiSxExtractor.write: 점수 대상이 아닌 usage", () => {
  it("other 속성과 정규화 안 된 값(비율 width 숫자 포함)은 null", () => {
    const code = JSX(`{ content: "가😀", boxShadow: "0 1px 2px #000", width: 0.5, height: "100dvh", color: "#111" }`);
    const usages = muiSxExtractor.extract({ root: "/", file: "a.tsx", code });
    expect(usages.map((u) => [u.property, muiSxExtractor.write(u, "x") === null])).toEqual([
      ["other", true],
      ["other", true],
      ["width", true],
      ["height", true],
      ["color", false],
    ]);
  });
});
