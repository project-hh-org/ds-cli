import { describe, expect, it } from "vitest";
import { runConformance } from "../src/conformance.js";
import type { ConformanceCase } from "../src/conformance.js";
import { JS_FILES, metaOf } from "../src/extractor.js";
import type { Extractor, ExtractorMeta, StyleUsage } from "../src/extractor.js";

const usage = (over: Partial<StyleUsage> = {}): StyleUsage => ({
  file: "a.tsx",
  line: 1,
  column: 10,
  property: "color",
  raw: "#ff0000",
  normalized: { kind: "color", hex: "#ff0000", l: 0.628, c: 0.258, h: 29.2 },
  source: "hardcoded",
  extractor: "dummy",
  ...over,
});

const makeExtractor = (
  extract: Extractor["extract"],
  meta: Partial<ExtractorMeta> = {},
): Extractor => ({
  name: "dummy",
  files: JS_FILES,
  parses: "tsx",
  appliesTo: () => true,
  extract,
  write: () => null,
  ...meta,
});

describe("runConformance", () => {
  it("extract가 expect를 그대로 반환하면 모든 케이스가 통과한다", () => {
    const expected = [usage()];
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: expected },
      { code: "y", file: "b.tsx", expect: [] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => expected), cases);
    expect(report).toEqual({ passed: 2, failed: [] });
  });

  it("빈 배열을 반환하면 expect가 비어있지 않은 케이스는 실패한다", () => {
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: [usage()] },
      { code: "y", file: "b.tsx", expect: [] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => []), cases);
    expect(report.passed).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.case).toBe(0);
    expect(report.failed[0]?.reason).toMatch(/nothing|아무것도|비어/);
  });

  it("partial 일부 필드만 지정하면 그 필드만 비교한다 (line/column 생략 가능)", () => {
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: [{ property: "color", raw: "#ff0000" }] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => [usage({ line: 7, column: 3 })]), cases);
    expect(report.failed).toEqual([]);
  });

  it("expect에 line/column이 있으면 비교하고 다르면 실패한다", () => {
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: [{ line: 2 }] },
      { code: "x", file: "a.tsx", expect: [{ column: 99 }] },
      { code: "x", file: "a.tsx", expect: [{ line: 1, column: 10 }] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => [usage()]), cases);
    expect(report.passed).toBe(1);
    expect(report.failed.map((f) => f.case)).toEqual([0, 1]);
  });

  it("normalized 같은 중첩 객체도 deep partial로 비교한다", () => {
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: [{ normalized: { kind: "color", hex: "#ff0000" } as StyleUsage["normalized"] }] },
      { code: "x", file: "a.tsx", expect: [{ normalized: { kind: "length", px: 4 } }] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => [usage()]), cases);
    expect(report.passed).toBe(1);
    expect(report.failed.map((f) => f.case)).toEqual([1]);
  });

  it("expect의 각 partial은 서로 다른 usage일 필요 없이 하나 이상의 usage와 매칭되면 된다", () => {
    const cases: ConformanceCase[] = [
      {
        code: "x",
        file: "a.tsx",
        expect: [{ property: "color" }, { property: "padding" }],
      },
    ];
    const report = runConformance(
      "dummy",
      () => makeExtractor(() => [usage(), usage({ property: "padding" })]),
      cases,
    );
    expect(report.failed).toEqual([]);
  });

  it("extract에 root '/', 케이스의 file/code를 전달하고 매 케이스마다 새 인스턴스를 만든다", () => {
    const seen: { root: string; file: string; code: string }[] = [];
    let made = 0;
    const cases: ConformanceCase[] = [
      { code: "c1", file: "f1.tsx", expect: [] },
      { code: "c2", file: "f2.tsx", expect: [] },
    ];
    runConformance(
      "dummy",
      () => {
        made++;
        return makeExtractor((ctx) => {
          seen.push(ctx);
          return [];
        });
      },
      cases,
    );
    expect(made).toBe(2);
    expect(seen).toEqual([
      { root: "/", file: "f1.tsx", code: "c1" },
      { root: "/", file: "f2.tsx", code: "c2" },
    ]);
  });

  it("extract가 throw하면 해당 케이스만 실패로 기록한다", () => {
    const cases: ConformanceCase[] = [{ code: "x", file: "a.tsx", expect: [] }];
    const report = runConformance(
      "dummy",
      () =>
        makeExtractor(() => {
          throw new Error("boom");
        }),
      cases,
    );
    expect(report.passed).toBe(0);
    expect(report.failed[0]?.reason).toContain("boom");
  });
});

describe("runConformance 메타 검사", () => {
  const okCases: ConformanceCase[] = [{ code: "x", file: "a.tsx", expect: [] }];

  it("files가 비어 있으면 case -1로 meta 실패를 기록하고 케이스는 계속 실행한다", () => {
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: [] },
      { code: "y", file: "b.tsx", expect: [usage()] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => [], { files: [] }), cases);
    expect(report.passed).toBe(1);
    expect(report.failed[0]?.case).toBe(-1);
    expect(report.failed[0]?.reason).toContain("meta");
    expect(report.failed.map((f) => f.case)).toEqual([-1, 1]);
  });

  it("name이 소문자 kebab-case가 아니면 meta 실패다", () => {
    for (const name of ["Bad_Name", "", "1abc", "has space", "UPPER"]) {
      const report = runConformance("dummy", () => makeExtractor(() => [], { name }), okCases);
      expect(report.failed[0]?.case).toBe(-1);
      expect(report.failed[0]?.reason).toContain("meta");
    }
  });

  it("parses가 tsx·none 외 값이면 meta 실패다", () => {
    const bad = { parses: "babel" } as unknown as Partial<ExtractorMeta>;
    const report = runConformance("dummy", () => makeExtractor(() => [], bad), okCases);
    expect(report.failed[0]?.case).toBe(-1);
    expect(report.failed[0]?.reason).toContain("meta");
  });

  it("정상 메타(parses none 포함)는 meta 실패 없이 통과한다", () => {
    for (const parses of ["tsx", "none"] as const) {
      const report = runConformance("dummy", () => makeExtractor(() => [], { parses }), okCases);
      expect(report).toEqual({ passed: 1, failed: [] });
    }
  });

  it("케이스가 없어도 메타는 검사한다", () => {
    const report = runConformance("dummy", () => makeExtractor(() => [], { files: [] }), []);
    expect(report.failed.map((f) => f.case)).toEqual([-1]);
  });

  it("signals가 있으면 모양을 검사한다: dependencies·files는 비지 않은 문자열 배열, code는 정규식 소스", () => {
    const bad: unknown[] = [
      null,
      "x",
      { dependencies: "tailwindcss" },
      { dependencies: [""] },
      { files: [] },
      { files: [1] },
      { code: 1 },
      { code: "(" },
      { code: "" },
      {},
    ];
    for (const signals of bad) {
      const report = runConformance(
        "dummy",
        () => makeExtractor(() => [], { signals } as unknown as Partial<ExtractorMeta>),
        okCases,
      );
      expect(report.failed[0]?.case, JSON.stringify(signals)).toBe(-1);
      expect(report.failed[0]?.reason).toContain("signals");
    }
  });

  it("정상 signals와 signals 없음은 meta 실패가 아니다", () => {
    const good: ExtractorMeta["signals"][] = [
      undefined,
      { dependencies: ["tailwindcss"] },
      { files: ["**/*.txt", "!**/skip/**"] },
      { code: "style=\\{\\{" },
      { dependencies: ["a"], files: ["b/**"], code: "c" },
    ];
    for (const signals of good) {
      const meta: Partial<ExtractorMeta> = signals === undefined ? {} : { signals };
      const report = runConformance("dummy", () => makeExtractor(() => [], meta), okCases);
      expect(report).toEqual({ passed: 1, failed: [] });
    }
  });
});

describe("metaOf", () => {
  it("name·files·parses만 추려 반환한다 (signals가 없으면 키도 없다)", () => {
    const e = makeExtractor(() => [], { name: "dummy-x", parses: "none" });
    const meta = metaOf(e);
    expect(meta).toEqual({ name: "dummy-x", files: JS_FILES, parses: "none" });
    expect(Object.keys(meta)).not.toContain("signals");
  });

  it("signals가 있으면 함께 복사한다", () => {
    const signals = { dependencies: ["x"], files: ["**/*.txt"], code: "y" };
    const e = makeExtractor(() => [], { name: "dummy-x", signals });
    expect(metaOf(e)).toEqual({ name: "dummy-x", files: JS_FILES, parses: "tsx", signals });
  });
});

describe("runConformance write+tokenRef 왕복", () => {
  const token = { name: "--c", value: "#ff0000", category: "color" as const, normalized: usage().normalized };
  const CODE = "a:#f00;b:#00f;";

  /** 코드 문자열에서 `#rrggbb`/`var(--c)` 모양을 직접 읽는 가짜 Extractor. */
  const fake = (over: Partial<Extractor> = {}): Extractor => {
    const patches = new WeakMap<StyleUsage, { start: number; end: number }>();
    return {
      name: "dummy",
      files: JS_FILES,
      parses: "none",
      appliesTo: () => true,
      extract: (ctx) =>
        [...ctx.code.matchAll(/(#[0-9a-f]{3}|var\(--c\))/g)].map((m) => {
          const u = usage({
            line: 1,
            column: m.index ?? 0,
            raw: m[0],
            source: m[0].startsWith("var") ? "token" : "hardcoded",
          });
          patches.set(u, { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
          return u;
        }),
      write: (u, ref) => {
        const p = patches.get(u);
        return p === undefined ? null : { file: "a.css", start: p.start, end: p.end, replacement: ref };
      },
      tokenRef: (t) => `var(${t.name})`,
      ...over,
    };
  };
  const writeCase = (over: Partial<ConformanceCase["writes"] extends (infer W)[] | undefined ? W : never> = {}): ConformanceCase => ({
    code: CODE,
    file: "a.css",
    expect: [],
    writes: [{ target: { raw: "#f00" }, token, ref: "var(--c)", reextract: { source: "token" }, ...over }],
  });

  it("정상 가짜는 통과한다(output 단언 포함)", () => {
    const report = runConformance("dummy", () => fake(), [writeCase({ output: "a:var(--c);b:#00f;" })]);
    expect(report).toEqual({ passed: 1, failed: [] });
  });

  it("writes가 있는데 tokenRef가 없으면 'tokenRef 없음'으로 실패한다", () => {
    const report = runConformance("dummy", () => fake({ tokenRef: undefined }), [writeCase()]);
    expect(report.failed[0]?.reason).toContain("tokenRef 없음");
  });

  it("ref 불일치는 실패한다", () => {
    const report = runConformance("dummy", () => fake(), [writeCase({ ref: "var(--x)" })]);
    expect(report.failed[0]?.reason).toContain("tokenRef");
  });

  it("ref가 null이면 null을 돌려줘야 통과하고 이후 검사는 생략한다", () => {
    const ok = runConformance("dummy", () => fake({ tokenRef: () => null }), [writeCase({ ref: null })]);
    expect(ok.failed).toEqual([]);
    const bad = runConformance("dummy", () => fake(), [writeCase({ ref: null })]);
    expect(bad.failed).toHaveLength(1);
  });

  it("재추출이 reextract와 다르면 실패한다", () => {
    const report = runConformance("dummy", () => fake({ tokenRef: () => "#abc" }), [writeCase({ ref: "#abc" })]);
    expect(report.failed[0]?.reason).toContain("reextract");
  });

  it("output이 다르면 실패한다", () => {
    const report = runConformance("dummy", () => fake(), [writeCase({ output: "nope" })]);
    expect(report.failed[0]?.reason).toContain("output");
  });

  it("target이 없거나 write가 null이면 실패한다", () => {
    expect(runConformance("dummy", () => fake(), [writeCase({ target: { raw: "zzz" } })]).failed).toHaveLength(1);
    expect(runConformance("dummy", () => fake({ write: () => null }), [writeCase()]).failed[0]?.reason).toContain("null");
  });

  it("다른 usage가 사라지는 write는 실패한다", () => {
    const patches = new WeakMap<StyleUsage, number>();
    const greedy = fake({
      extract: (ctx) =>
        [...ctx.code.matchAll(/(#[0-9a-f]{3}|var\(--c\))/g)].map((m) => {
          const u = usage({ line: 1, column: m.index ?? 0, raw: m[0], source: m[0].startsWith("var") ? "token" : "hardcoded" });
          patches.set(u, m.index ?? 0);
          return u;
        }),
      // 전체 코드를 지워 버린다
      write: () => ({ file: "a.css", start: 0, end: CODE.length, replacement: "var(--c)" }),
    });
    const report = runConformance("dummy", () => greedy, [writeCase()]);
    expect(report.failed[0]?.reason).toContain("바뀜");
    // 사라진 키·새로 생긴 키를 메시지에 싣는다
    expect(report.failed[0]?.reason).toContain("#00f");
  });

  it("같은 줄에 기대와 일치하는 기존 usage가 먼저 나와도 새로 생긴 usage를 치환 결과로 본다", () => {
    const withExisting = fake({
      extract: (ctx) =>
        [...ctx.code.matchAll(/(#[0-9a-f]{3}|var\(--[cd]\))/g)].map((m) =>
          usage({ line: 1, column: m.index ?? 0, raw: m[0], source: m[0].startsWith("var") ? "token" : "hardcoded" }),
        ),
      write: (u) => {
        const column = u.column;
        return { file: "a.css", start: column, end: column + u.raw.length, replacement: "var(--c)" };
      },
    });
    const report = runConformance("dummy", () => withExisting, [
      { code: "a:var(--d);b:#f00;", file: "a.css", expect: [], writes: [{ target: { raw: "#f00" }, token, ref: "var(--c)", reextract: { source: "token" } }] },
    ]);
    expect(report).toEqual({ passed: 1, failed: [] });
  });
});

describe("tokenRef 관련 export", () => {
  it("cssVarRef는 CSS 변수 이름만 var()로 감싼다", async () => {
    const { cssVarRef, TAILWIND_PRESET_PREFIX } = await import("../src/extractor.js");
    const t = (name: string) => ({ name, value: "", category: "color" as const, normalized: { kind: "unknown" as const } });
    expect(cssVarRef(t("--color-blue-500"))).toBe("var(--color-blue-500)");
    expect(cssVarRef(t("color.brand"))).toBeNull();
    expect(cssVarRef(t("--a b"))).toBeNull();
    expect(TAILWIND_PRESET_PREFIX).toBe("ds");
  });

  it("tokenRef가 있어도 metaOf 키는 name·files·parses(·signals)다", () => {
    const e = makeExtractor(() => [], { tokenRef: () => null });
    expect(Object.keys(metaOf(e))).toEqual(["name", "files", "parses"]);
    expect(Object.keys(metaOf({ ...e, signals: { code: "x" } }))).toEqual(["name", "files", "parses", "signals"]);
  });
});
