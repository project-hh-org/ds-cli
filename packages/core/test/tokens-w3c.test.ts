import { describe, expect, it } from "vitest";
import type { StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
import { normalizeColor } from "../src/normalize/color.js";
import { buildTokenDraft, draftToTokens } from "../src/tokens/draft.js";
import { draftToW3c, readW3cTokens, serializeW3c } from "../src/tokens/w3c.js";

function color(hex: string, property: StyleProperty = "color"): StyleUsage {
  const normalized = normalizeColor(hex)!;
  return { file: "src/a.tsx", line: 1, column: 1, property, raw: hex, normalized, source: "hardcoded", extractor: "test" };
}
function len(px: number, property: StyleProperty): StyleUsage {
  return {
    file: "src/a.tsx", line: 1, column: 1, property, raw: `${px}px`,
    normalized: { kind: "length", px }, source: "hardcoded", extractor: "test",
  };
}

const usages = [
  color("#3b82f6"), color("#3b82f6"), color("#3c83f7"), color("#111111"),
  len(8, "padding"), len(8, "padding"), len(16, "gap"),
  len(6, "border-radius"), len(14, "font-size"), len(16, "font-size"),
];

describe("serializeW3c", () => {
  const draft = buildTokenDraft(usages);
  const json = draftToW3c(draft) as Record<string, Record<string, any>>;

  it("색은 2025.10 객체 값, 길이는 {value, unit}", () => {
    const blue = Object.values(json.color!).find((t) => t.$value.hex === "#3b82f6")!;
    expect(blue.$type).toBe("color");
    expect(blue.$value).toEqual({ colorSpace: "srgb", components: [0.2314, 0.5098, 0.9647], hex: "#3b82f6" });
    const space = json.space!["2"];
    expect(space.$type).toBe("dimension");
    expect(space.$value).toEqual({ value: 8, unit: "px" });
    expect(json.radius!.md.$value).toEqual({ value: 6, unit: "px" });
  });

  it("확장은 dev.dsmith, 루트 $description, 이름에 점 없음", () => {
    const blue = Object.values(json.color!).find((t) => t.$value.hex === "#3b82f6")!;
    expect(blue.$extensions["dev.dsmith"]).toMatchObject({ category: "color", usageCount: 3 });
    expect(blue.$extensions["dev.dsmith"].members).toContain("#3b82f6");
    expect(typeof json.$description).toBe("string");
    for (const group of ["color", "space", "radius", "text"]) {
      for (const key of Object.keys(json[group] ?? {})) expect(key).not.toMatch(/[.{}]/);
    }
  });

  it("스냅샷", () => {
    expect(serializeW3c(draft)).toMatchSnapshot();
  });
});

describe("readW3cTokens", () => {
  it("직렬화 → 읽기 왕복에서 토큰이 같다", () => {
    const draft = buildTokenDraft(usages);
    const read = readW3cTokens(serializeW3c(draft), "tokens.json");
    expect(read.warnings).toEqual([]);
    const expected = draftToTokens(draft);
    expect(read.tokens.map((t) => [t.name, t.category, t.value])).toEqual(
      expected.map((t) => [t.name, t.category, t.value]),
    );
    for (const [i, t] of read.tokens.entries()) {
      const e = expected[i]!;
      if (e.normalized.kind === "length") expect(t.normalized).toEqual(e.normalized);
      else expect(t.normalized).toMatchObject({ kind: "color", hex: e.normalized.hex });
    }
  });

  it("구형 문자열 값을 읽는다", () => {
    const text = JSON.stringify({
      color: { brand: { $value: "#3B82F6", $type: "color" } },
      spacing: { $type: "dimension", sm: { $value: "8px" } },
      radius: { md: { $type: "dimension", $value: { value: 0.375, unit: "rem" } } },
    });
    const { tokens } = readW3cTokens(text, "t.json");
    const by = Object.fromEntries(tokens.map((t) => [t.name, t]));
    expect(by["--color-brand"]).toMatchObject({ category: "color", normalized: { hex: "#3b82f6" } });
    expect(by["--spacing-sm"]).toMatchObject({ category: "spacing", normalized: { px: 8 } });
    expect(by["--radius-md"]).toMatchObject({ category: "radius", normalized: { px: 6 } });
  });

  it("별칭을 같은 파일에서 해석하고 순환은 경고 후 건너뛴다", () => {
    const ok = readW3cTokens(
      JSON.stringify({
        color: { blue: { $type: "color", $value: "#00f" }, primary: { $type: "color", $value: "{color.blue}" } },
      }),
      "t.json",
    );
    expect(ok.tokens.find((t) => t.name === "--color-primary")?.normalized).toMatchObject({ hex: "#0000ff" });

    const loop = readW3cTokens(
      JSON.stringify({
        color: { a: { $type: "color", $value: "{color.b}" }, b: { $type: "color", $value: "{color.a}" }, c: { $type: "color", $value: "#fff" } },
      }),
      "t.json",
    );
    expect(loop.warnings).toHaveLength(2);
    expect(loop.tokens.map((t) => t.name)).toEqual(["--color-c"]);
  });

  it("$ref·깨진 JSON·다른 타입", () => {
    expect(readW3cTokens("{oops", "bad.json")).toEqual({ tokens: [], warnings: ["토큰 JSON을 읽을 수 없음: bad.json"] });
    const r = readW3cTokens(
      JSON.stringify({ a: { $type: "color", $value: { $ref: "#/b/$value" } }, f: { $type: "fontFamily", $value: "Inter" } }),
      "t.json",
    );
    expect(r.tokens).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("다른 colorSpace는 변환한다", () => {
    const r = readW3cTokens(
      JSON.stringify({ c: { $type: "color", $value: { colorSpace: "srgb", components: [1, 0, 0] } } }),
      "t.json",
    );
    expect(r.tokens[0]?.normalized).toMatchObject({ hex: "#ff0000" });
  });
});
