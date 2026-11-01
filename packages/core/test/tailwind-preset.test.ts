import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftToken, TokenDraft } from "../src/tokens/draft.js";
import { parseCssDeclarations } from "../src/parse/css-text.js";
import { parseTsx } from "../src/parse/tsx.js";
import {
  emitTailwindPreset,
  findTailwindConfig,
  isPresetLinked,
  listCssFiles,
  parsePresetKeys,
  presetFileName,
  presetFormatFor,
  readTailwindPreset,
  type PresetFormat,
} from "../src/tokens/tailwind-preset.js";

function tok(group: DraftToken["group"], key: string, value: string): DraftToken {
  const category = { color: "color", space: "spacing", radius: "radius", text: "font-size" }[group] as DraftToken["category"];
  return {
    category,
    group,
    key,
    name: `${group}-${key}`,
    value,
    normalized: { kind: "unknown" },
    usageCount: 1,
    members: [value],
  };
}

const DRAFT: TokenDraft = {
  tokens: [tok("color", "blue-400", "#3b82f6"), tok("space", "2", "8px"), tok("radius", "sm", "4px"), tok("text", "xs", "12px")],
  mappings: [],
};
const KEYS = { "--color-blue-400": "ds-blue-400", "--space-2": "ds-2", "--radius-sm": "ds-sm", "--text-xs": "ds-xs" };
const FORMATS: PresetFormat[] = ["v3-ts", "v3-cjs", "v4-css"];

describe("emitTailwindPreset 스냅샷", () => {
  it.each(FORMATS)("%s", (format) => {
    expect(emitTailwindPreset(DRAFT, format)).toMatchSnapshot();
  });

  it("빈 그룹은 생략하고, 토큰이 없으면 빈 extend", () => {
    const onlyColor = emitTailwindPreset({ tokens: [DRAFT.tokens[0] as DraftToken], mappings: [] }, "v3-ts");
    expect(onlyColor).not.toContain("spacing");
    expect(onlyColor).toContain("colors");
    expect(emitTailwindPreset({ tokens: [], mappings: [] }, "v3-cjs")).toContain("extend: {}");
    expect(emitTailwindPreset({ tokens: [], mappings: [] }, "v4-css")).toContain("@theme inline {\n\n}");
  });

  it("outDir를 안내 주석에 반영", () => {
    expect(emitTailwindPreset(DRAFT, "v3-ts", { outDir: "ds" })).toContain('from "./ds/tailwind.preset"');
    expect(emitTailwindPreset(DRAFT, "v4-css", { outDir: "ds" })).toContain('@import "./ds/tailwind.theme.css"');
  });
});

describe("parsePresetKeys", () => {
  it.each(FORMATS)("%s 왕복", (format) => {
    expect(parsePresetKeys(emitTailwindPreset(DRAFT, format), format)).toEqual(KEYS);
  });

  it.each(FORMATS)("%s: 사람이 한 줄 지우면 그 키만 빠진다", (format) => {
    const text = emitTailwindPreset(DRAFT, format)
      .split("\n")
      .filter((l) => !l.includes("ds-2"))
      .join("\n");
    const { "--space-2": _gone, ...rest } = KEYS;
    expect(parsePresetKeys(text, format)).toEqual(rest);
  });

  it("v3-ts 출력은 파싱 오류가 없다", () => {
    const parsed = parseTsx(emitTailwindPreset(DRAFT, "v3-ts"), "tailwind.preset.ts");
    expect(parsed.errors ?? []).toHaveLength(0);
  });

  it("v4 출력의 선언 수 = 토큰 수", () => {
    const css = emitTailwindPreset(DRAFT, "v4-css");
    const decls = parseCssDeclarations(css, 0, {}).filter((d) => d.property.startsWith("--"));
    expect(decls).toHaveLength(DRAFT.tokens.length);
  });
});

describe("presetFileName · presetFormatFor", () => {
  it("파일 이름과 형식 선택", () => {
    expect(presetFileName("v3-ts")).toBe("tailwind.preset.ts");
    expect(presetFileName("v3-cjs")).toBe("tailwind.preset.cjs");
    expect(presetFileName("v4-css")).toBe("tailwind.theme.css");
    expect(presetFormatFor(4, "tailwind.config.ts")).toBe("v4-css");
    expect(presetFormatFor(3, "tailwind.config.ts")).toBe("v3-ts");
    expect(presetFormatFor(3, "tailwind.config.mts")).toBe("v3-ts");
    expect(presetFormatFor(3, "tailwind.config.js")).toBe("v3-cjs");
    expect(presetFormatFor(3, "tailwind.config.cjs")).toBe("v3-cjs");
    expect(presetFormatFor(3, null)).toBe("v3-cjs");
  });
});

describe("readTailwindPreset", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-twpreset-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const put = (rel: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), content);
  };

  it("v3: presets와 import가 있으면 linked", async () => {
    put("design-system/tailwind.preset.ts", emitTailwindPreset(DRAFT, "v3-ts"));
    put(
      "tailwind.config.ts",
      'import dsPreset from "./design-system/tailwind.preset";\nexport default { presets: [dsPreset], content: [] };\n',
    );
    const p = await readTailwindPreset(tmp, { initDir: "design-system", tailwindVersion: 3, cssFiles: [] });
    expect(p).toEqual({ version: 3, file: "design-system/tailwind.preset.ts", linked: true, keys: KEYS });
  });

  it("v3: require 형태·확장자 포함 import도 연결로 본다", async () => {
    put("design-system/tailwind.preset.cjs", emitTailwindPreset(DRAFT, "v3-cjs"));
    put("tailwind.config.cjs", 'const dsPreset = require("./design-system/tailwind.preset.cjs");\nmodule.exports = { presets: [dsPreset] };\n');
    expect((await readTailwindPreset(tmp, { initDir: "design-system", cssFiles: [] }))?.linked).toBe(true);
  });

  it("v3: presets가 없거나 import가 없으면 linked false", async () => {
    put("design-system/tailwind.preset.ts", emitTailwindPreset(DRAFT, "v3-ts"));
    put("tailwind.config.ts", 'import dsPreset from "./design-system/tailwind.preset";\nexport default { content: [] };\n');
    expect((await readTailwindPreset(tmp, { initDir: "design-system", cssFiles: [] }))?.linked).toBe(false);
    put("tailwind.config.ts", "export default { presets: [], content: [] };\n");
    expect((await readTailwindPreset(tmp, { initDir: "design-system", cssFiles: [] }))?.linked).toBe(false);
  });

  it("v3: tailwind.config가 없으면 linked false", async () => {
    put("design-system/tailwind.preset.ts", emitTailwindPreset(DRAFT, "v3-ts"));
    expect((await readTailwindPreset(tmp, { initDir: "design-system", cssFiles: [] }))?.linked).toBe(false);
  });

  it("v4: CSS의 @import 줄에 tailwind.theme.css가 있으면 linked", async () => {
    put("design-system/tailwind.theme.css", emitTailwindPreset(DRAFT, "v4-css"));
    put("src/app.css", '@import "tailwindcss";\n@import "../design-system/tailwind.theme.css";\n');
    const p = await readTailwindPreset(tmp, { initDir: "design-system", tailwindVersion: 4, cssFiles: await listCssFiles(tmp) });
    expect(p).toEqual({ version: 4, file: "design-system/tailwind.theme.css", linked: true, keys: KEYS });
  });

  it("v4: 주석이나 import 아닌 언급은 연결이 아니다", async () => {
    put("design-system/tailwind.theme.css", emitTailwindPreset(DRAFT, "v4-css"));
    put("src/app.css", '@import "tailwindcss";\n/* tailwind.theme.css 추가 예정 */\n');
    const p = await readTailwindPreset(tmp, { initDir: "design-system", cssFiles: ["src/app.css"] });
    expect(p?.linked).toBe(false);
  });

  it("생성 파일 자신의 안내 주석(@import …)은 연결로 세지 않는다", async () => {
    put("design-system/tailwind.theme.css", emitTailwindPreset(DRAFT, "v4-css"));
    const p = await readTailwindPreset(tmp, { initDir: "design-system", cssFiles: await listCssFiles(tmp) });
    expect(p?.linked).toBe(false);
    put("design-system/tailwind.preset.ts", emitTailwindPreset(DRAFT, "v3-ts"));
    put("tailwind.config.ts", '// presets: import "./design-system/tailwind.preset"\nexport default {};\n');
    expect((await readTailwindPreset(tmp, { initDir: "design-system", tailwindVersion: 3, cssFiles: [] }))?.linked).toBe(false);
  });

  describe("v4 연결 판정 (경로 해석)", () => {
    const linkedV4 = async (): Promise<boolean> => isPresetLinked(tmp, "design-system", 4);
    beforeEach(() => put("design-system/tailwind.theme.css", emitTailwindPreset(DRAFT, "v4-css")));

    it("진입 CSS 기준 상대 경로가 <initDir>/tailwind.theme.css이고 @import tailwindcss가 같은 파일에 있으면 true", async () => {
      put("src/app.css", '@import "tailwindcss";\n@import "../design-system/tailwind.theme.css";\n');
      expect(await linkedV4()).toBe(true);
    });

    it("url()·작은따옴표 표기도 같은 파일로 해석한다", async () => {
      put("src/app.css", "@import 'tailwindcss';\n@import url(\"../design-system/tailwind.theme.css\");\n");
      expect(await linkedV4()).toBe(true);
      put("src/app.css", "@import url('tailwindcss');\n@import url(../design-system/tailwind.theme.css);\n");
      expect(await linkedV4()).toBe(true);
    });

    it("루트 CSS(./design-system/…)도 true", async () => {
      put("app.css", '@import "tailwindcss";\n@import "./design-system/tailwind.theme.css";\n');
      expect(await linkedV4()).toBe(true);
    });

    it("패키지 지정자(@acme/ui/tailwind.theme.css)는 false", async () => {
      put("src/app.css", '@import "tailwindcss";\n@import "@acme/ui/tailwind.theme.css";\n');
      expect(await linkedV4()).toBe(false);
    });

    it("다른 디렉터리에서 해석되는 상대 경로(src/ 아래 ./design-system/…)는 false", async () => {
      put("src/app.css", '@import "tailwindcss";\n@import "./design-system/tailwind.theme.css";\n');
      expect(await linkedV4()).toBe(false);
    });

    it("@import tailwindcss가 없는 CSS(비진입)는 false", async () => {
      put("src/other.css", '@import "../design-system/tailwind.theme.css";\n');
      expect(await linkedV4()).toBe(false);
    });

    it("@import tailwindcss가 주석 안에만 있으면 false", async () => {
      put("src/app.css", '/* @import "tailwindcss"; */\n@import "../design-system/tailwind.theme.css";\n');
      expect(await linkedV4()).toBe(false);
    });

    it("@import tailwindcss와 theme import가 서로 다른 파일에 있으면 false", async () => {
      put("src/a.css", '@import "tailwindcss";\n');
      put("src/b.css", '@import "../design-system/tailwind.theme.css";\n');
      expect(await linkedV4()).toBe(false);
    });

    it("initDir이 '.'이면 루트의 tailwind.theme.css를 가리켜야 한다", async () => {
      put("tailwind.theme.css", emitTailwindPreset(DRAFT, "v4-css", { outDir: "." }));
      put("src/app.css", '@import "tailwindcss";\n@import "../tailwind.theme.css";\n');
      expect(await isPresetLinked(tmp, ".", 4)).toBe(true);
    });

    it("프리셋 파일이 아직 없어도(dry-run) 경로가 맞으면 true", async () => {
      fs.rmSync(path.join(tmp, "design-system"), { recursive: true });
      put("src/app.css", '@import "tailwindcss";\n@import "../design-system/tailwind.theme.css";\n');
      expect(await linkedV4()).toBe(true);
    });
  });

  describe("v3 연결 판정 (문자열·presets 배열)", () => {
    beforeEach(() => put("design-system/tailwind.preset.ts", emitTailwindPreset(DRAFT, "v3-ts")));

    it("content 글롭의 /* … **/ 가 블록 주석으로 오인되지 않는다", async () => {
      put(
        "tailwind.config.ts",
        'import dsPreset from "./design-system/tailwind.preset";\n' +
          'export default { content: ["./src/*.tsx"], presets: [dsPreset], safelist: ["./app/**/*.tsx"] };\n',
      );
      expect(await isPresetLinked(tmp, "design-system", 3)).toBe(true);
    });

    it("문자열 안의 // 는 주석이 아니다", async () => {
      put(
        "tailwind.config.ts",
        'import dsPreset from "./design-system/tailwind.preset";\nexport default { x: "http://a.b", presets: [dsPreset] };\n',
      );
      expect(await isPresetLinked(tmp, "design-system", 3)).toBe(true);
    });

    it("import만 하고 presets에는 다른 식별자가 있으면 false", async () => {
      put(
        "tailwind.config.ts",
        'import dsPreset from "./design-system/tailwind.preset";\nimport other from "other-preset";\nexport default { presets: [other] };\n',
      );
      expect(await isPresetLinked(tmp, "design-system", 3)).toBe(false);
    });

    it("require 식별자가 presets에 없으면 false, 있으면 true, 인라인 require도 true", async () => {
      put("design-system/tailwind.preset.cjs", emitTailwindPreset(DRAFT, "v3-cjs"));
      put(
        "tailwind.config.cjs",
        'const ds = require("./design-system/tailwind.preset.cjs");\nconst other = require("x");\nmodule.exports = { presets: [other] };\n',
      );
      expect(await isPresetLinked(tmp, "design-system", 3)).toBe(false);
      put(
        "tailwind.config.cjs",
        'const ds = require("./design-system/tailwind.preset.cjs");\nmodule.exports = { presets: [require("x"), ds] };\n',
      );
      expect(await isPresetLinked(tmp, "design-system", 3)).toBe(true);
      put("tailwind.config.cjs", 'module.exports = { presets: [require("./design-system/tailwind.preset")] };\n');
      expect(await isPresetLinked(tmp, "design-system", 3)).toBe(true);
    });

    it("별칭·구조 분해 import도 식별자로 본다", async () => {
      put(
        "tailwind.config.ts",
        'import { default as ds } from "./design-system/tailwind.preset";\nexport default { presets: [ds] };\n',
      );
      expect(await isPresetLinked(tmp, "design-system", 3)).toBe(true);
    });
  });

  it("프리셋 파일이 없거나 initDir이 null이면 null, tailwindVersion이 다른 버전 파일은 무시", async () => {
    expect(await readTailwindPreset(tmp, { initDir: "design-system", cssFiles: [] })).toBeNull();
    expect(await readTailwindPreset(tmp, { initDir: null, cssFiles: [] })).toBeNull();
    put("design-system/tailwind.preset.ts", emitTailwindPreset(DRAFT, "v3-ts"));
    expect(await readTailwindPreset(tmp, { initDir: "design-system", tailwindVersion: 4, cssFiles: [] })).toBeNull();
  });

  it("findTailwindConfig: 루트 config 확장자 우선순위", async () => {
    expect(await findTailwindConfig(tmp)).toBeNull();
    put("tailwind.config.js", "");
    expect(await findTailwindConfig(tmp)).toBe("tailwind.config.js");
    put("tailwind.config.ts", "");
    expect(await findTailwindConfig(tmp)).toBe("tailwind.config.ts");
  });
});
