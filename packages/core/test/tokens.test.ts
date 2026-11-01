import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeColor } from "../src/normalize/color.js";
import { normalizeLength } from "../src/normalize/length.js";
import { rankTokens } from "../src/match/token-matcher.js";
import { loadTokens, tokenCategoryOf, tokensFromCatalog } from "../src/tokens/load.js";
import { proposalTokens } from "../src/tokens/proposal.js";
import { buildTokenDraft } from "../src/tokens/draft.js";
import { emitTokensCss, emitTokensTs } from "../src/tokens/emit.js";
import { serializeW3c } from "../src/tokens/w3c.js";
import { readCssVariableTokens } from "../src/tokens/css-variables.js";

function colorUsage(raw: string, property: StyleUsage["property"] = "color"): StyleUsage {
  const normalized = normalizeColor(raw);
  if (normalized === null) throw new Error(raw);
  return { file: "a.tsx", line: 1, column: 1, property, raw, normalized, source: "hardcoded", extractor: "test" };
}

function lengthUsage(raw: string, property: StyleUsage["property"] = "padding"): StyleUsage {
  const px = normalizeLength(raw);
  if (px === null) throw new Error(raw);
  return {
    file: "a.tsx",
    line: 1,
    column: 1,
    property,
    raw,
    normalized: { kind: "length", px },
    source: "hardcoded",
    extractor: "test",
  };
}

describe("readCssVariableTokens", () => {
  const css =
    ":root{--color-primary:#3b82f6;--space-2:8px;--radius-md:6px;--text-sm:14px;--brand:var(--color-primary);--shadow:0 1px 2px #000}";
  const tokens = readCssVariableTokens(css, "tokens.css");
  const byName = (name: string) => tokens.find((t) => t.name === name);

  it("색·길이 변수만 파일 등장 순으로 읽는다(--shadow 제외)", () => {
    expect(tokens.map((t) => t.name)).toEqual([
      "--color-primary",
      "--space-2",
      "--radius-md",
      "--text-sm",
      "--brand",
    ]);
  });

  it("카테고리를 값과 이름으로 가른다", () => {
    expect(byName("--color-primary")?.category).toBe("color");
    expect(byName("--space-2")).toMatchObject({ category: "spacing", value: "8px", normalized: { kind: "length", px: 8 } });
    expect(byName("--radius-md")?.category).toBe("radius");
    expect(byName("--text-sm")?.category).toBe("font-size");
  });

  it("var(--x) 하나인 값은 같은 파일의 변수로 1단계 해석한다", () => {
    expect(byName("--brand")).toMatchObject({ category: "color", normalized: { kind: "color", hex: "#3b82f6" } });
  });

  it("해석할 수 없는 var()는 버린다", () => {
    expect(readCssVariableTokens(":root{--a:var(--missing)}", "t.css")).toEqual([]);
  });

  it("블록과 상관없이 읽고 주석은 무시한다", () => {
    const out = readCssVariableTokens(
      "/* --old: #fff; */ .dark{--bg:#000} @media (min-width:1px){:root{--gap-1:4px}}",
      "t.css",
    );
    expect(out.map((t) => t.name)).toEqual(["--bg", "--gap-1"]);
  });

  it("rem 값은 px로 정규화하되 value는 원문이다", () => {
    const [t] = readCssVariableTokens(":root{--space-4:1rem}", "t.css");
    expect(t).toMatchObject({ value: "1rem", normalized: { kind: "length", px: 16 } });
  });
});

describe("proposalTokens", () => {
  it("근접한 파랑 두 개는 토큰 하나로 묶인다", () => {
    const tokens = proposalTokens([colorUsage("#3b82f6"), colorUsage("#3b82f6"), colorUsage("#3c83f7")]);
    const colors = tokens.filter((t) => t.category === "color");
    expect(colors).toHaveLength(1);
    expect(colors[0]?.name).toMatch(/^blue-/);
    expect(colors[0]?.value).toBe("#3b82f6");
  });

  it("같은 suggestedName 두 클러스터는 -2 접미로 구분한다", () => {
    // 같은 hue/명도 구간이지만 서로 0.03 넘게 떨어진 색
    const a = colorUsage("#3b82f6");
    const b = colorUsage("#5b7cf5");
    const tokens = proposalTokens([a, a, b]);
    const names = tokens.filter((t) => t.category === "color").map((t) => t.name);
    expect(names).toHaveLength(2);
    expect(names[1]).toBe(`${names[0]}-2`);
  });

  it("간격은 4px 스케일 위의 값만 space-N으로 낸다", () => {
    const tokens = proposalTokens([lengthUsage("13px"), lengthUsage("8px"), lengthUsage("8px")]);
    const spacing = tokens.filter((t) => t.category === "spacing");
    expect(spacing).toEqual([
      { name: "space-2", value: "8px", normalized: { kind: "length", px: 8 }, category: "spacing" },
    ]);
  });

  it("합성 클러스터 입력에서 color 토큰의 normalized는 대표색이다", () => {
    const [t] = proposalTokens([colorUsage("#ef4444")]);
    expect(t?.normalized).toMatchObject({ kind: "color", hex: "#ef4444" });
  });

  it("사용이 없으면 빈 배열이다", () => {
    expect(proposalTokens([])).toEqual([]);
  });
});

describe("tokenCategoryOf", () => {
  it("속성을 토큰 카테고리로 옮긴다", () => {
    expect(tokenCategoryOf("background-color")).toBe("color");
    expect(tokenCategoryOf("stroke")).toBe("color");
    expect(tokenCategoryOf("gap")).toBe("spacing");
    expect(tokenCategoryOf("height")).toBe("spacing");
    expect(tokenCategoryOf("border-radius")).toBe("radius");
    expect(tokenCategoryOf("font-size")).toBe("font-size");
    expect(tokenCategoryOf("other")).toBeNull();
  });
});

describe("loadTokens", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-tokens-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("tokens.css가 있으면 source token-file", async () => {
    fs.writeFileSync(path.join(dir, "tokens.css"), ":root{--color-primary:#3b82f6;--space-2:8px}");
    const loaded = await loadTokens(dir, ["tokens.css"], [colorUsage("#ff0000")]);
    expect(loaded.source).toBe("token-file");
    expect(loaded.files).toEqual(["tokens.css"]);
    expect(loaded.ignored).toEqual([]);
    expect(loaded.tokens.map((t) => t.name)).toEqual(["--color-primary", "--space-2"]);
  });

  it("theme.ts만 있으면 proposal이고 ignored에 남는다", async () => {
    fs.writeFileSync(path.join(dir, "theme.ts"), "export const theme = {}");
    const loaded = await loadTokens(dir, ["theme.ts"], [colorUsage("#ef4444")]);
    expect(loaded.source).toBe("proposal");
    expect(loaded.files).toEqual([]);
    expect(loaded.ignored).toEqual(["theme.ts"]);
    expect(loaded.tokens).toHaveLength(1);
  });

  it("tokenFiles가 비면 proposal이다", async () => {
    const loaded = await loadTokens(dir, [], [lengthUsage("8px")]);
    expect(loaded.source).toBe("proposal");
    expect(loaded.tokens.map((t) => t.name)).toEqual(["space-2"]);
  });

  it("토큰이 0개인 css는 proposal로 떨어지되 files에는 남는다", async () => {
    fs.writeFileSync(path.join(dir, "empty.css"), ".a{color:red}");
    const loaded = await loadTokens(dir, ["empty.css"], [lengthUsage("8px")]);
    expect(loaded.source).toBe("proposal");
    expect(loaded.files).toEqual(["empty.css"]);
  });

  it("읽을 수 없는 파일은 건너뛴다", async () => {
    fs.writeFileSync(path.join(dir, "tokens.css"), ":root{--space-1:4px}");
    const loaded = await loadTokens(dir, ["missing.css", "tokens.css"], []);
    expect(loaded.source).toBe("token-file");
    expect(loaded.files).toEqual(["tokens.css"]);
  });
});

const SHADCN_V3 = `
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
  }
}
`;

const SHADCN_V4 = `
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-lg: var(--radius);
}
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
}
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
}
`;

const TAILWIND_V4 = `
@import "tailwindcss";
@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --color-brand: #3b82f6;
  --color-blue-500: oklch(0.623 0.214 259.815);
  --color-accent: rebeccapurple;
  --font-weight-bold: 700;
  --text-sm: 0.875rem;
  --text-sm--line-height: 1.25rem;
  --text-xs--line-height: calc(1 / 0.75);
  --spacing: 0.25rem;
  --radius-lg: 0.5rem;
  --breakpoint-sm: 40rem;
  --container-md: 28rem;
  --blur-sm: 8px;
  --tracking-tight: -0.025em;
  --z-modal: 10;
  --opacity-half: 0.5;
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
}
`;

describe("읽기 정확도 (I1·I2)", () => {
  const tokens = readCssVariableTokens(TAILWIND_V4, "app.css");
  const names = tokens.map((t) => t.name);

  it("Tailwind v4 @theme에서 색·간격·반경·글자 크기만 읽는다", () => {
    expect(names).toEqual([
      "--color-brand",
      "--color-blue-500",
      "--color-accent",
      "--text-sm",
      "--spacing",
      "--radius-lg",
    ]);
  });

  it("숫자만 있는 값은 색이 아니다(--font-weight-bold: 700)", () => {
    expect(names).not.toContain("--font-weight-bold");
    expect(readCssVariableTokens(":root{--n:700;--m:123456;--o:0.5}", "t.css")).toEqual([]);
  });

  it("단위 없는 숫자는 길이가 아니다(--z-modal: 10), 맨 0은 허용", () => {
    expect(names).not.toContain("--z-modal");
    expect(readCssVariableTokens(":root{--space-0:0;--space-x:10}", "t.css").map((t) => t.name)).toEqual([
      "--space-0",
    ]);
  });

  it("blur·breakpoint·container·line-height·tracking 변수는 분류하지 않는다", () => {
    for (const n of ["--blur-sm", "--breakpoint-sm", "--container-md", "--text-sm--line-height", "--tracking-tight"]) {
      expect(names).not.toContain(n);
    }
  });

  it("padding: 8px 순위에 --blur-sm이 나오지 않는다", () => {
    const withBlur = readCssVariableTokens(":root{--blur-sm:8px;--space-2:8px}", "t.css");
    const ranked = rankTokens({ kind: "length", px: 8 }, withBlur, { category: "spacing" });
    expect(ranked.map((r) => r.token.name)).toEqual(["--space-2"]);
  });

  it("CSS 색 이름과 색 함수를 인정한다", () => {
    expect(tokens.find((t) => t.name === "--color-accent")?.normalized).toMatchObject({ kind: "color", hex: "#663399" });
    expect(readCssVariableTokens(":root{--a:rgb(0 0 0);--b:hsl(10 50% 50%);--c:color(srgb 1 0 0)}", "t.css")).toHaveLength(3);
  });

  it("글자 크기 이름은 --font-size-/--text-/--fs- 접두로 한정한다", () => {
    const out = readCssVariableTokens(":root{--fs-lg:18px;--font-size-base:16px;--context-gap:4px;--text-sm:14px}", "t.css");
    expect(out.map((t) => [t.name, t.category])).toEqual([
      ["--fs-lg", "font-size"],
      ["--font-size-base", "font-size"],
      ["--context-gap", "spacing"],
      ["--text-sm", "font-size"],
    ]);
  });
});

describe("첫 선언 우선·HSL 삼중항 (I3·I4a)", () => {
  it("shadcn v4: @theme inline이 :root보다 앞이어도 시맨틱 토큰은 라이트 값으로 풀린다", () => {
    const tokens = readCssVariableTokens(SHADCN_V4, "globals.css");
    const light = normalizeColor("oklch(1 0 0)")!;
    expect(tokens.find((t) => t.name === "--color-background")?.normalized).toMatchObject({ hex: light.hex });
    expect(tokens.find((t) => t.name === "--background")?.normalized).toMatchObject({ hex: light.hex });
    const dark = normalizeColor("oklch(0.145 0 0)")!;
    expect(tokens.find((t) => t.name === "--color-foreground")?.normalized).toMatchObject({ hex: dark.hex });
    expect(tokens.filter((t) => t.name === "--background")).toHaveLength(1);
  });

  it("shadcn v4: calc() 반경은 버리고 var(--radius) 반경은 읽는다", () => {
    const tokens = readCssVariableTokens(SHADCN_V4, "globals.css");
    expect(tokens.find((t) => t.name === "--radius-sm")).toBeUndefined();
    expect(tokens.find((t) => t.name === "--radius-lg")).toMatchObject({ category: "radius", normalized: { px: 10 } });
  });

  it("shadcn v3: hsl 삼중항을 색으로 읽고 value는 원문이다", () => {
    const tokens = readCssVariableTokens(SHADCN_V3, "globals.css");
    expect(tokens.map((t) => t.name)).toEqual(["--background", "--foreground", "--primary", "--radius"]);
    expect(tokens[0]).toMatchObject({ value: "0 0% 100%", category: "color", normalized: { hex: "#ffffff" } });
    // .dark의 같은 이름 선언은 무시
    expect(tokens.filter((t) => t.name === "--background")).toHaveLength(1);
    expect(tokens.find((t) => t.name === "--radius")?.category).toBe("radius");
  });
});

describe("var() 해석 (M4)", () => {
  it("대체값을 쓴다 — 참조가 없을 때만", () => {
    const out = readCssVariableTokens(":root{--a:var(--missing,#fff);--b:var(--missing, rgb(0 0 0));--c:var(--missing)}", "t.css");
    expect(out.map((t) => t.name)).toEqual(["--a", "--b"]);
    expect(out[1]).toMatchObject({ value: "var(--missing, rgb(0 0 0))", normalized: { hex: "#000000" } });
  });

  it("5단계까지 따라가고 그 이상·순환은 버린다", () => {
    const chain = ":root{--c0:#123456;--c1:var(--c0);--c2:var(--c1);--c3:var(--c2);--c4:var(--c3);--c5:var(--c4);--c6:var(--c5)}";
    const names = readCssVariableTokens(chain, "t.css").map((t) => t.name);
    expect(names).toContain("--c5");
    expect(names).not.toContain("--c6");
    expect(readCssVariableTokens(":root{--x:var(--y);--y:var(--x)}", "t.css")).toEqual([]);
  });

  it("aliases 인자로 다른 파일의 변수를 참조한다", () => {
    const out = readCssVariableTokens(":root{--brand:var(--base)}", "b.css", new Map([["--base", "#ff0000"]]));
    expect(out[0]).toMatchObject({ name: "--brand", normalized: { hex: "#ff0000" } });
  });
});

describe("loadTokens — 카테고리별 폴백 (I4b·M1·M5)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-tokens2-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("shadcn v3 파일: 색이 파일에서 오고, 간격만 제안으로 채워 mixed", async () => {
    fs.writeFileSync(path.join(dir, "globals.css"), SHADCN_V3);
    const loaded = await loadTokens(dir, ["globals.css"], [colorUsage("#ef4444"), lengthUsage("8px")]);
    const colors = loaded.tokens.filter((t) => t.category === "color");
    expect(colors.map((t) => t.source)).toEqual(["token-file", "token-file", "token-file"]);
    expect(loaded.tokens.find((t) => t.name === "--radius")?.source).toBe("token-file");
    expect(loaded.tokens.find((t) => t.name === "space-2")?.source).toBe("proposal");
    expect(loaded.source).toBe("mixed");
    expect(loaded.warnings).toEqual([]);
  });

  it("radius만 있는 파일: 색은 제안, radius는 파일, mixed + 경고", async () => {
    fs.writeFileSync(path.join(dir, "tokens.css"), ":root{--radius-md:6px}");
    const loaded = await loadTokens(dir, ["tokens.css"], [colorUsage("#ef4444")]);
    expect(loaded.tokens.map((t) => [t.name, t.source])).toEqual([
      ["--radius-md", "token-file"],
      ["red-400", "proposal"],
    ]);
    expect(loaded.source).toBe("mixed");
    expect(loaded.warnings).toEqual(["토큰 파일에서 색 토큰을 찾지 못함"]);
  });

  it("모든 카테고리가 파일에 있으면 제안은 섞이지 않는다", async () => {
    fs.writeFileSync(path.join(dir, "tokens.css"), ":root{--color-a:#fff;--space-1:4px}");
    const loaded = await loadTokens(dir, ["tokens.css"], [colorUsage("#ef4444"), lengthUsage("8px")]);
    expect(loaded.source).toBe("token-file");
    expect(loaded.tokens.every((t) => t.source === "token-file")).toBe(true);
  });

  it("읽을 수 없는 파일은 warnings에 남는다", async () => {
    const loaded = await loadTokens(dir, ["nope.css"], []);
    expect(loaded.warnings).toEqual(["토큰 파일을 읽을 수 없음: nope.css"]);
    expect(loaded.source).toBe("proposal");
  });

  it("같은 이름은 먼저 나온 파일이 이기고, var()는 파일 사이에서도 풀린다", async () => {
    fs.writeFileSync(path.join(dir, "a.css"), ":root{--c:#111111;--brand:var(--base)}");
    fs.writeFileSync(path.join(dir, "b.css"), ":root{--c:#222222;--base:#ff0000}");
    const loaded = await loadTokens(dir, ["a.css", "b.css"], []);
    expect(loaded.tokens.filter((t) => t.name === "--c")).toHaveLength(1);
    expect(loaded.tokens.find((t) => t.name === "--c")?.normalized).toMatchObject({ hex: "#111111" });
    expect(loaded.tokens.find((t) => t.name === "--brand")?.normalized).toMatchObject({ hex: "#ff0000" });
  });
});

describe("loadTokens .json", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-tokens-json-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("init 산출 3종은 중복 없이 token-file로 읽고 tokens.ts는 ignored에 넣지 않는다", async () => {
    const draft = buildTokenDraft([colorUsage("#3b82f6"), colorUsage("#111111"), lengthUsage("8px")]);
    fs.mkdirSync(path.join(dir, "design-system"));
    fs.writeFileSync(path.join(dir, "design-system/tokens.json"), serializeW3c(draft));
    fs.writeFileSync(path.join(dir, "design-system/tokens.css"), emitTokensCss(draft));
    fs.writeFileSync(path.join(dir, "design-system/tokens.ts"), emitTokensTs(draft));
    const loaded = await loadTokens(
      dir,
      ["design-system/tokens.json", "design-system/tokens.css", "design-system/tokens.ts"],
      [],
    );
    expect(loaded.source).toBe("token-file");
    expect(loaded.tokens).toHaveLength(draft.tokens.length);
    expect(loaded.ignored).toEqual([]);
    expect(loaded.tokens.every((t) => t.file === "design-system/tokens.css")).toBe(true);
  });

  it("깨진 tokens.json은 warnings·ignored에 싣고 제안으로 채운다", async () => {
    fs.writeFileSync(path.join(dir, "tokens.json"), "{oops");
    const loaded = await loadTokens(dir, ["tokens.json"], [colorUsage("#ef4444")]);
    expect(loaded.warnings).toContain("토큰 JSON을 읽을 수 없음: tokens.json");
    expect(loaded.ignored).toEqual(["tokens.json"]);
    expect(loaded.source).toBe("proposal");
  });

  it("json만 있으면 file이 json이다", async () => {
    fs.writeFileSync(
      path.join(dir, "tokens.json"),
      JSON.stringify({ color: { brand: { $type: "color", $value: "#3b82f6" } } }),
    );
    const loaded = await loadTokens(dir, ["tokens.json"], []);
    expect(loaded.tokens).toEqual([expect.objectContaining({ name: "--color-brand", source: "token-file", file: "tokens.json" })]);
  });
});

describe("tokensFromCatalog", () => {
  const colorTokens = [
    { name: "--color-primary", value: "#3b82f6", category: "color" as const, file: "design-system/tokens.json" },
  ];

  it("색만 있는 카탈로그 토큰 + 간격 usage → mixed, 색은 catalog·간격은 proposal", () => {
    const loaded = tokensFromCatalog(colorTokens, [lengthUsage("12px"), lengthUsage("12px")]);
    expect(loaded.source).toBe("mixed");
    expect(loaded.tokens.filter((t) => t.source === "catalog").map((t) => t.name)).toEqual(["--color-primary"]);
    expect(loaded.tokens.find((t) => t.source === "catalog")?.file).toBe("design-system/tokens.json");
    expect(loaded.tokens.filter((t) => t.source === "proposal").every((t) => t.category === "spacing")).toBe(true);
    expect(loaded.tokens.some((t) => t.source === "proposal")).toBe(true);
  });

  it("모든 카테고리가 카탈로그에 있으면 제안 없이 catalog", () => {
    const loaded = tokensFromCatalog(
      [
        ...colorTokens,
        { name: "--space-2", value: "8px", category: "spacing" as const, file: "t.json" },
        { name: "--radius-md", value: "6px", category: "radius" as const, file: "t.json" },
        { name: "--font-size-md", value: "14px", category: "font-size" as const, file: "t.json" },
      ],
      [lengthUsage("12px")],
    );
    expect(loaded.source).toBe("catalog");
    expect(loaded.tokens.every((t) => t.source === "catalog")).toBe(true);
  });
});
