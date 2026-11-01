import { runConformance } from "@dsmith-dev/extractor-api";
import type { StyleUsage, WritePatch } from "@dsmith-dev/extractor-api";
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

describe("muiSxExtractor.tokenRef + conformance write 왕복", () => {
  const blue = { name: "--color-gray-900", value: "#111", category: "color" as const, normalized: { kind: "color" as const, hex: "#111111", l: 0.2, c: 0, h: 0 } };
  const space4 = { name: "--space-4", value: "16px", category: "spacing" as const, normalized: { kind: "length" as const, px: 16 } };
  const space3 = { name: "--space-3", value: "12px", category: "spacing" as const, normalized: { kind: "length" as const, px: 12 } };
  const text = { name: "--text-xs", value: "12px", category: "font-size" as const, normalized: { kind: "length" as const, px: 12 } };
  const radius = { name: "--radius-md", value: "8px", category: "radius" as const, normalized: { kind: "length" as const, px: 8 } };

  it("정확히 8의 배수인 간격은 숫자 스케일, 나머지는 CSS 변수", () => {
    const report = runConformance("mui-sx", () => muiSxExtractor, [
      {
        file: "s/a.tsx",
        code: JSX(`{ p: "16px", color: "#111" }`),
        expect: [],
        writes: [
          { target: { property: "padding" }, token: space4, ref: "2", output: JSX(`{ p: 2, color: "#111" }`), reextract: { source: "token", property: "padding" } },
          { target: { property: "color" }, token: blue, ref: "var(--color-gray-900)", output: JSX(`{ p: "16px", color: "var(--color-gray-900)" }`), reextract: { source: "token", property: "color" } },
        ],
      },
      {
        file: "s/a.tsx",
        code: JSX(`{ p: "13px", fontSize: 13, borderRadius: "8px" }`),
        expect: [],
        writes: [
          { target: { property: "padding" }, token: space3, ref: "var(--space-3)", output: JSX(`{ p: "var(--space-3)", fontSize: 13, borderRadius: "8px" }`), reextract: { source: "token", property: "padding" } },
          { target: { property: "font-size" }, token: text, ref: "var(--text-xs)", output: JSX(`{ p: "13px", fontSize: "var(--text-xs)", borderRadius: "8px" }`), reextract: { source: "token", property: "font-size" } },
          { target: { property: "border-radius" }, token: radius, ref: "var(--radius-md)", reextract: { source: "token", property: "border-radius" } },
        ],
      },
      {
        // 값이 정확히 같지 않거나(close) 문자열 일부(다중 값)만 치환하는 경우에는 숫자 스케일을 쓰지 않는다
        file: "s/a.tsx",
        code: JSX(`{ margin: "var(--m) 16px", gap: "15px" }`),
        expect: [],
        writes: [
          { target: { raw: "16px" }, token: space4, ref: "var(--space-4)", reextract: { source: "token", property: "margin" } },
          { target: { raw: "15px" }, token: space4, ref: "var(--space-4)", reextract: { source: "token", property: "gap" } },
        ],
      },
      {
        file: "s/a.tsx",
        code: JSX(`{ p: "0px", m: "-16px" }`),
        expect: [],
        writes: [
          { target: { property: "padding" }, token: { ...space4, normalized: { kind: "length" as const, px: 0 } }, ref: "var(--space-4)", reextract: { source: "token", property: "padding" } },
        ],
      },
    ]);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(4);
  });

  it("숫자 스케일 write는 리터럴 구간이 없으면 null", () => {
    const code = JSX(`{ margin: "var(--m) 16px" }`);
    expect(muiSxExtractor.write(find(code, "16px"), "2")).toBeNull();
  });
});

describe("muiSxExtractor.tokenRef: 숫자 스케일은 간격 속성에만", () => {
  const space = { name: "--space-4", value: "16px", category: "spacing" as const, normalized: { kind: "length" as const, px: 16 } };

  it("width/height 값은 간격 토큰이어도 숫자 스케일(=200%)을 쓰지 않는다", () => {
    const code = JSX(`{ width: "16px", height: "16px", p: "16px" }`);
    const [w, h, p] = muiSxExtractor.extract({ root: "/", file: "a.tsx", code });
    expect(muiSxExtractor.tokenRef!(space, w!, {})).toBeNull();
    expect(muiSxExtractor.tokenRef!(space, h!, {})).toBeNull();
    expect(muiSxExtractor.tokenRef!(space, p!, {})).toBe("2");
  });

  it("margin·gap 계열 장문 키는 숫자 스케일을 쓴다", () => {
    const code = JSX(`{ marginTop: "16px", gap: "16px" }`);
    const usages = muiSxExtractor.extract({ root: "/", file: "a.tsx", code });
    expect(usages.map((u) => muiSxExtractor.tokenRef!(space, u, {}))).toEqual(["2", "2"]);
  });
});
