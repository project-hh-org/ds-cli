import { parseTsx } from "@dsmith/core";
import { JS_FILES, metaOf, runConformance, type ConformanceCase } from "@dsmith/extractor-api";
import { describe, expect, it } from "vitest";
import { KNOWN_UTILITIES } from "../src/class-parser.js";
import { RULES } from "../src/extract.js";
import { defaultTheme, tailwindExtractor } from "../src/index.js";

const cases: ConformanceCase[] = [
  {
    file: "a.tsx",
    code: `export const A = () => <div className="text-[#3B82F6] p-[13px]" />;`,
    expect: [
      {
        property: "color",
        source: "hardcoded",
        normalized: { kind: "color", hex: "#3b82f6" },
      },
      { property: "padding", source: "hardcoded", normalized: { kind: "length", px: 13 } },
    ],
  },
  {
    file: "b.tsx",
    code: `export const B = () => <div className="text-blue-500 p-4" />;`,
    expect: [
      { property: "color", source: "tailwind-default", normalized: { kind: "color", hex: "#3b82f6" } },
      { property: "padding", source: "tailwind-default", normalized: { kind: "length", px: 16 } },
    ],
  },
  {
    file: "c.tsx",
    code: "export const C = () => <div className={`p-4 ${active ? \"bg-red-500\" : \"\"}`} />;",
    expect: [
      { property: "padding", raw: "p-4", source: "tailwind-default" },
      { property: "background-color", raw: "bg-red-500", source: "tailwind-default" },
    ],
  },
  {
    file: "d.tsx",
    code: `export const D = () => <div className={cn("p-4", props.className)} />;`,
    expect: [
      { property: "padding", raw: "p-4" },
      { property: "other", raw: "props.className", source: "dynamic", normalized: { kind: "unknown" } },
    ],
  },
  {
    file: "e.tsx",
    code: `export const E = () => <div className="bg-[var(--brand)]" />;`,
    expect: [{ property: "background-color", source: "token", normalized: { kind: "unknown" } }],
  },
];

const ctx = (file: string, code: string) => ({ root: "/", file, code });
const run = (code: string, file = "x.tsx") => tailwindExtractor.extract(ctx(file, code));
const summary = (code: string) =>
  run(code).map((u) => [u.property, u.raw, u.source, u.normalized] as const);

describe("tailwindExtractor", () => {
  it("conformance 케이스를 모두 통과한다", () => {
    const report = runConformance("tailwind", () => tailwindExtractor, cases);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(cases.length);
  });

  it("메타는 JS_FILES를 대상으로 하고 tsx를 파싱한다", () => {
    expect(metaOf(tailwindExtractor)).toEqual({
      name: "tailwind",
      files: JS_FILES,
      parses: "tsx",
    });
  });

  it("name은 tailwind이고 usage의 extractor도 tailwind다", () => {
    expect(tailwindExtractor.name).toBe("tailwind");
    const [usage] = run(`const x = <div className="p-4" />;`);
    expect(usage?.extractor).toBe("tailwind");
  });

  describe("appliesTo", () => {
    it("확장자가 JS/TS 소스(ts/tsx/js/jsx, mjs/cjs 등)이고 className이 있을 때만 true다", () => {
      const code = `<div className="p-4" />`;
      for (const file of ["a.tsx", "a.jsx", "a.ts", "a.js", "a.mjs", "a.cjs", "a.mts", "a.cts"]) {
        expect(tailwindExtractor.appliesTo(ctx(file, code))).toBe(true);
      }
      expect(tailwindExtractor.appliesTo(ctx("a.css", code))).toBe(false);
      expect(tailwindExtractor.appliesTo(ctx("a.tsx", `<div style={{}} />`))).toBe(false);
    });
  });

  describe("색상", () => {
    it("arbitrary 색은 hardcoded로 정규화한다", () => {
      expect(summary(`const x = <div className="bg-[#fff] border-[rgb(0,0,0)]" />;`)).toEqual([
        ["background-color", "bg-[#fff]", "hardcoded", expect.objectContaining({ kind: "color", hex: "#ffffff" })],
        ["border-color", "border-[rgb(0,0,0)]", "hardcoded", expect.objectContaining({ kind: "color", hex: "#000000" })],
      ]);
    });

    it("유틸리티별 property 매핑", () => {
      const props = run(
        `const x = <div className="text-red-500 bg-red-500 border-red-500 fill-red-500 stroke-red-500 ring-red-500 outline-red-500" />;`,
      ).map((u) => u.property);
      expect(props).toEqual([
        "color",
        "background-color",
        "border-color",
        "fill",
        "stroke",
        "border-color",
        "border-color",
      ]);
    });

    it("black/white를 기본 테마에서 해석한다", () => {
      expect(summary(`const x = <div className="text-white bg-black" />;`)).toEqual([
        ["color", "text-white", "tailwind-default", expect.objectContaining({ hex: "#ffffff" })],
        ["background-color", "bg-black", "tailwind-default", expect.objectContaining({ hex: "#000000" })],
      ]);
    });

    it("커스텀 테마 키는 token 소스 + unknown이다", () => {
      expect(summary(`const x = <div className="text-primary-500 bg-primary" />;`)).toEqual([
        ["color", "text-primary-500", "token", { kind: "unknown" }],
        ["background-color", "bg-primary", "token", { kind: "unknown" }],
      ]);
    });

    it("arbitrary 색이 파싱되지 않으면 hardcoded + unknown이다", () => {
      expect(summary(`const x = <div className="bg-[foo]" />;`)).toEqual([
        ["background-color", "bg-[foo]", "hardcoded", { kind: "unknown" }],
      ]);
    });

    it("arbitrary var(--…) 값은 token + unknown이고 property는 매핑된 것을 유지한다", () => {
      expect(
        summary(`const x = <div className="bg-[var(--brand)] p-[var(--space-2)] text-[color:var(--fg)] text-[var(--x)]" />;`),
      ).toEqual([
        ["background-color", "bg-[var(--brand)]", "token", { kind: "unknown" }],
        ["padding", "p-[var(--space-2)]", "token", { kind: "unknown" }],
        ["color", "text-[color:var(--fg)]", "token", { kind: "unknown" }],
        ["other", "text-[var(--x)]", "token", { kind: "unknown" }],
      ]);
    });

    it("color: 타입 힌트를 벗겨 해석한다", () => {
      expect(summary(`const x = <div className="text-[color:#3B82F6]" />;`)).toEqual([
        ["color", "text-[color:#3B82F6]", "hardcoded", expect.objectContaining({ hex: "#3b82f6" })],
      ]);
    });
  });

  describe("text- 색/크기 구분", () => {
    it("크기 키워드는 font-size다", () => {
      expect(summary(`const x = <div className="text-sm text-base text-2xl" />;`)).toEqual([
        ["font-size", "text-sm", "tailwind-default", { kind: "length", px: 14 }],
        ["font-size", "text-base", "tailwind-default", { kind: "length", px: 16 }],
        ["font-size", "text-2xl", "tailwind-default", { kind: "length", px: 24 }],
      ]);
    });

    it("text-[13px]는 font-size, text-[#3B82F6]은 color다", () => {
      expect(summary(`const x = <div className="text-[13px] text-[#3B82F6]" />;`)).toEqual([
        ["font-size", "text-[13px]", "hardcoded", { kind: "length", px: 13 }],
        ["color", "text-[#3B82F6]", "hardcoded", expect.objectContaining({ kind: "color" })],
      ]);
    });

    it("정렬·줄바꿈 등 비-스타일 text-* 는 무시한다", () => {
      expect(run(`const x = <div className="text-center text-left text-ellipsis" />;`)).toEqual([]);
    });

    it("해석할 수 없는 text-[...]는 property other + unknown이다", () => {
      expect(summary(`const x = <div className="text-[foo]" />;`)).toEqual([
        ["other", "text-[foo]", "hardcoded", { kind: "unknown" }],
      ]);
    });
  });

  describe("길이", () => {
    it("유틸리티별 property 매핑", () => {
      const props = run(
        `const x = <div className="p-1 px-1 py-1 pt-1 pr-1 pb-1 pl-1 m-1 mx-1 my-1 mt-1 mr-1 mb-1 ml-1 gap-1 gap-x-1 gap-y-1 w-1 min-w-1 max-w-1 h-1 min-h-1 max-h-1" />;`,
      ).map((u) => u.property);
      expect(props).toEqual([
        ...Array<string>(7).fill("padding"),
        ...Array<string>(7).fill("margin"),
        ...Array<string>(3).fill("gap"),
        ...Array<string>(3).fill("width"),
        ...Array<string>(3).fill("height"),
      ]);
    });

    it("spacing 스케일을 px로 해석한다", () => {
      expect(summary(`const x = <div className="p-0 p-px p-0.5 p-4 p-96" />;`).map((s) => s[3])).toEqual([
        { kind: "length", px: 0 },
        { kind: "length", px: 1 },
        { kind: "length", px: 2 },
        { kind: "length", px: 16 },
        { kind: "length", px: 384 },
      ]);
    });

    it("arbitrary rem은 px로 환산한다", () => {
      expect(summary(`const x = <div className="p-[1.5rem] w-[13px]" />;`)).toEqual([
        ["padding", "p-[1.5rem]", "hardcoded", { kind: "length", px: 24 }],
        ["width", "w-[13px]", "hardcoded", { kind: "length", px: 13 }],
      ]);
    });

    it("파싱 불가 arbitrary 길이는 hardcoded + unknown이다", () => {
      expect(summary(`const x = <div className="w-[calc(100%-2px)]" />;`)).toEqual([
        ["width", "w-[calc(100%-2px)]", "hardcoded", { kind: "unknown" }],
      ]);
    });

    it("negative는 길이 부호를 뒤집는다", () => {
      expect(summary(`const x = <div className="-mt-2 -ml-[4px] -mx-0" />;`)).toEqual([
        ["margin", "-mt-2", "tailwind-default", { kind: "length", px: -8 }],
        ["margin", "-ml-[4px]", "hardcoded", { kind: "length", px: -4 }],
        ["margin", "-mx-0", "tailwind-default", { kind: "length", px: 0 }],
      ]);
    });

    it("border-radius 스케일", () => {
      expect(
        summary(`const x = <div className="rounded rounded-md rounded-full rounded-t-lg rounded-[10px]" />;`),
      ).toEqual([
        ["border-radius", "rounded", "tailwind-default", { kind: "length", px: 4 }],
        ["border-radius", "rounded-md", "tailwind-default", { kind: "length", px: 6 }],
        ["border-radius", "rounded-full", "tailwind-default", { kind: "length", px: 9999 }],
        ["border-radius", "rounded-t-lg", "tailwind-default", { kind: "length", px: 8 }],
        ["border-radius", "rounded-[10px]", "hardcoded", { kind: "length", px: 10 }],
      ]);
    });

    it("p-md/gap-lg/m-xl 같은 커스텀 spacing 토큰은 token이다", () => {
      expect(summary(`const x = <div className="p-md gap-lg m-xl rounded-xl" />;`)).toEqual([
        ["padding", "p-md", "token", { kind: "unknown" }],
        ["gap", "gap-lg", "token", { kind: "unknown" }],
        ["margin", "m-xl", "token", { kind: "unknown" }],
        ["border-radius", "rounded-xl", "tailwind-default", { kind: "length", px: 12 }],
      ]);
    });

    it("max-w/min-w 컨테이너 크기 이름은 무시한다", () => {
      expect(run(`const x = <div className="max-w-md min-w-xl max-w-7xl" />;`)).toEqual([]);
    });

    it("모델에 없는 길이 이름은 token 소스다", () => {
      expect(summary(`const x = <div className="rounded-card p-gutter" />;`)).toEqual([
        ["border-radius", "rounded-card", "token", { kind: "unknown" }],
        ["padding", "p-gutter", "token", { kind: "unknown" }],
      ]);
    });

    it("full/auto/screen/분수 같은 키워드는 usage를 만들지 않는다", () => {
      expect(
        run(`const x = <div className="w-full h-screen w-1/2 m-auto mx-auto max-w-screen-lg max-w-2xl min-h-0 max-w-none" />;`).map((u) => u.raw),
      ).toEqual(["min-h-0"]);
    });
  });

  describe("무시 대상", () => {
    it("매핑하지 않은 유틸리티와 폭 유틸리티는 usage를 만들지 않는다", () => {
      expect(
        run(
          `const x = <div className="flex items-center justify-between border border-2 border-t-2 ring-2 ring-offset-2 outline-none stroke-2 fill-current font-bold shadow-md opacity-50 bg-cover bg-gradient-to-r" />;`,
        ),
      ).toEqual([]);
    });

    it("arbitrary 폭·이미지 값은 색 usage를 만들지 않는다", () => {
      expect(run(`const x = <div className="border-[3px] bg-[url(/a.png)] ring-[2px]" />;`)).toEqual([]);
    });

    it("슬래시 불투명도 수식어는 무시한다", () => {
      expect(run(`const x = <div className="bg-blue-500/50 bg-[#fff]/50" />;`)).toEqual([]);
    });

    it("side 접두 border 색은 border-color다", () => {
      expect(summary(`const x = <div className="border-t-red-500" />;`)).toEqual([
        ["border-color", "border-t-red-500", "tailwind-default", expect.objectContaining({ hex: "#ef4444" })],
      ]);
    });
  });

  describe("class 문자열 출처", () => {
    it("class 속성과 string literal 컨테이너를 읽는다", () => {
      expect(run(`const x = <div class="p-4" />;`).map((u) => u.raw)).toEqual(["p-4"]);
      expect(run(`const x = <div className={"p-4"} />;`).map((u) => u.raw)).toEqual(["p-4"]);
      expect(run(`const x = <div id="p-4" />;`)).toEqual([]);
    });

    it("variant가 붙은 토큰도 raw에 variant를 보존한다", () => {
      expect(summary(`const x = <div className="md:hover:text-[#3B82F6]" />;`)).toEqual([
        ["color", "md:hover:text-[#3B82F6]", "hardcoded", expect.objectContaining({ hex: "#3b82f6" })],
      ]);
    });

    it("clsx/twMerge 호출과 조건·논리식 인자를 재귀한다", () => {
      const code = `const x = <div className={twMerge("p-4", cond && "m-2", flag ? "w-8" : "h-8", [ "gap-2" ])} />;`;
      expect(run(code).map((u) => u.raw)).toEqual(["p-4", "m-2", "w-8", "h-8", "gap-2"]);
    });

    it("&& 왼쪽 조건식은 dynamic으로 세지 않는다", () => {
      const code = `const x = <div className={cn(isActive && "p-4")} />;`;
      expect(run(code).map((u) => [u.raw, u.source])).toEqual([["p-4", "tailwind-default"]]);
    });

    it("|| 왼쪽 비리터럴은 dynamic 1건이다", () => {
      const code = `const x = <div className={props.className || "p-4"} />;`;
      expect(run(code).map((u) => [u.raw, u.source])).toEqual([
        ["props.className", "dynamic"],
        ["p-4", "tailwind-default"],
      ]);
    });

    it("템플릿 ${} 비리터럴은 dynamic 1건만 만든다", () => {
      const code = "const x = <div className={`p-4 ${size}`} />;";
      expect(run(code).map((u) => [u.property, u.raw, u.source])).toEqual([
        ["padding", "p-4", "tailwind-default"],
        ["other", "size", "dynamic"],
      ]);
    });

    it("중첩된 비리터럴을 이중 집계하지 않는다", () => {
      const code = 'const x = <div className={cn(a ? b : c, `${d}`)} />;';
      const dynamic = run(code).filter((u) => u.source === "dynamic");
      expect(dynamic.map((u) => u.raw)).toEqual(["b", "c", "d"]);
    });

    it("식별자 단독 className은 dynamic 1건이다", () => {
      expect(run(`const x = <div className={styles} />;`).map((u) => [u.raw, u.source])).toEqual([
        ["styles", "dynamic"],
      ]);
    });

    it("${}에 붙은 부분 토큰은 건너뛴다", () => {
      const code = "const x = <div className={`p-${n} ${p}-4 m-2`} />;";
      expect(run(code).filter((u) => u.source !== "dynamic").map((u) => u.raw)).toEqual(["m-2"]);
    });

    it("undefined/void 0 분기는 dynamic을 만들지 않는다", () => {
      for (const empty of ["undefined", "void 0", "null", "false"]) {
        const code = `const x = <div className={cond ? "p-4" : ${empty}} />;`;
        expect(run(code).map((u) => [u.raw, u.source])).toEqual([["p-4", "tailwind-default"]]);
      }
      const code = `const x = <div className={cn("p-4", cond && undefined, other || void 0)} />;`;
      expect(run(code).map((u) => [u.raw, u.source])).toEqual([
        ["p-4", "tailwind-default"],
        ["other", "dynamic"],
      ]);
    });

    it("빈 문자열과 숫자·불리언 인자는 아무것도 만들지 않는다", () => {
      expect(run(`const x = <div className={cn("", false, 0)} />;`)).toEqual([]);
      expect(run(`const x = <div className="" />;`)).toEqual([]);
    });
  });

  describe("important 수식어", () => {
    it("앞·뒤 !를 벗겨 해석하고 raw는 전체 토큰이다", () => {
      expect(summary(`const x = <div className="!bg-[#fff] md:!p-[13px] p-4!" />;`)).toEqual([
        ["background-color", "!bg-[#fff]", "hardcoded", expect.objectContaining({ hex: "#ffffff" })],
        ["padding", "md:!p-[13px]", "hardcoded", { kind: "length", px: 13 }],
        ["padding", "p-4!", "tailwind-default", { kind: "length", px: 16 }],
      ]);
    });
  });

  describe("테마 조회", () => {
    it("프로토타입 속성 이름은 tailwind-default가 되지 않는다", () => {
      const usages = run(`const x = <div className="p-constructor text-toString bg-hasOwnProperty rounded-valueOf" />;`);
      expect(usages.map((u) => u.source)).not.toContain("tailwind-default");
      expect(usages.every((u) => u.source === "token")).toBe(true);
    });
  });

  describe("위치", () => {
    it("line은 1-based, column은 0-based로 토큰 위치를 가리킨다", () => {
      const code = `const x = (\n  <div className="flex p-4" />\n);`;
      const [usage] = run(code);
      // `  <div className="` = 18자, "flex " 5자 → p-4는 column 23
      expect(usage).toMatchObject({ file: "x.tsx", line: 2, column: 23, raw: "p-4" });
    });

    it("여러 줄 문자열 안의 토큰도 정확한 줄/열을 가진다", () => {
      const code = `const x = <div className={\`\n  flex\n    p-4\n\`} />;`;
      const [usage] = run(code);
      expect(usage).toMatchObject({ line: 3, column: 4, raw: "p-4" });
    });

    it("이스케이프가 있는 문자열에서도 원본 오프셋을 쓴다", () => {
      const code = `const x = <div className={cn("a\\nb p-4")} />;`;
      const [usage] = run(code);
      expect(usage?.raw).toBe("p-4");
      expect(usage?.column).toBe(code.indexOf("p-4"));
    });
  });

  it("복구 불가능한 문법 오류는 예외를 던진다", () => {
    const code = `const x = <div className="p-4" />;\nconst = ;`;
    expect(() => parseTsx(code, "i.tsx")).toThrow();
    expect(() => run(code, "i.tsx")).toThrow();
  });
});

describe("RULES", () => {
  it("모든 규칙 키는 KNOWN_UTILITIES에 있다", () => {
    for (const name of RULES.keys()) expect(KNOWN_UTILITIES).toContain(name);
  });
});

describe("defaultTheme", () => {
  it("색 팔레트: 22색 × 11단계 + black/white", () => {
    expect(Object.keys(defaultTheme.colors)).toHaveLength(22 * 11 + 2);
    expect(defaultTheme.colors["blue-500"]).toBe("#3b82f6");
    expect(defaultTheme.colors["slate-50"]).toBe("#f8fafc");
    expect(defaultTheme.colors["rose-950"]).toBe("#4c0519");
    expect(defaultTheme.colors["black"]).toBe("#000000");
    expect(defaultTheme.colors["white"]).toBe("#ffffff");
  });

  it("모든 색은 소문자 6자리 hex다", () => {
    for (const hex of Object.values(defaultTheme.colors)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("spacing 스케일", () => {
    expect(defaultTheme.spacing["4"]).toBe(16);
    expect(defaultTheme.spacing["px"]).toBe(1);
    expect(defaultTheme.spacing["0.5"]).toBe(2);
    expect(defaultTheme.spacing["96"]).toBe(384);
    expect(Object.keys(defaultTheme.spacing)).toHaveLength(35);
  });
});
