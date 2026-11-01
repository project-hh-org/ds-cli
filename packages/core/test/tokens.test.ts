import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeColor } from "../src/normalize/color.js";
import { normalizeLength } from "../src/normalize/length.js";
import { loadTokens, tokenCategoryOf } from "../src/tokens/load.js";
import { proposalTokens } from "../src/tokens/proposal.js";
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
