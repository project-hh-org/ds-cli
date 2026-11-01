import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexRepo, type ComponentUsage, type Index, type StyleUsage } from "@dsmith/core";
import type { ExtractorMeta } from "@dsmith/extractor-api";
import { decideState, detect, readDetect, writeDetect } from "../src/index.js";
import { sharesFromIndex, sharesFromSources } from "../src/detect-state.js";
import { loadSources } from "../src/fs-utils.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-detect-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 임시 레포에 파일을 만든다. 값이 null이면 빈 디렉터리. */
function repo(files: Record<string, string | null>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, rel);
    if (content === null) {
      fs.mkdirSync(abs, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function meta(name: string): ExtractorMeta {
  return { name, files: ["**/*.{tsx,jsx,ts,js}"], parses: "tsx" };
}

/** 현재 CLI 레지스트리와 같은 두 Extractor. */
const AVAILABLE: ExtractorMeta[] = [meta("tailwind"), meta("inline-style")];

function pkg(deps:Record<string, string> = {}, devDeps: Record<string, string> = {}): string {
  return JSON.stringify({ name: "app", dependencies: deps, devDependencies: devDeps });
}

function style(extractor: string, source: StyleUsage["source"]): StyleUsage {
  return {
    file: "a.tsx",
    line: 1,
    column: 1,
    property: "color",
    raw: "#ff0000",
    normalized: { kind: "color", hex: "#ff0000", l: 0.63, c: 0.26, h: 29 },
    source,
    extractor,
  };
}

/** 디자인 속성이 아닌 inline 값(`display: "flex"`, `opacity: 0.5`)과 같은 모양의 usage. */
function layoutStyle(raw: string): StyleUsage {
  return { ...style("inline-style", "hardcoded"), property: "other", raw, normalized: { kind: "unknown" } };
}

/** module을 따로 주지 않으면 importedFrom을 그대로 쓴다(이전 index.json을 읽을 때와 같은 규칙). */
function comp(name: string, importedFrom: string | null, module = importedFrom ?? ""): ComponentUsage {
  return { file: "a.tsx", line: 1, name, importedFrom, module, props: [] };
}

function indexOf(styles: StyleUsage[], components: ComponentUsage[]): Index {
  return {
    root: tmp,
    createdAt: "2026-11-01T00:00:00.000Z",
    extractors: ["tailwind", "inline-style"],
    files: { scanned: 1, skipped: [] },
    styles,
    components,
  };
}

describe("styling 감지", () => {
  it("tailwindcss 의존성과 tailwind.config.ts가 있으면 tailwind 방식과 근거를 보고한다", async () => {
    repo({ "package.json": pkg({}, { tailwindcss: "^3.4.0" }), "tailwind.config.ts": "export default {}" });
    const r = await detect(tmp);
    const tw = r.styling.methods.find((m) => m.name === "tailwind");
    expect(tw).toBeDefined();
    expect(tw?.evidence).toContain("tailwind.config.ts");
    expect(tw?.evidence).toContain("package.json: tailwindcss");
    expect(r.activeExtractors).toEqual(["tailwind"]);
  });

  it("CSS의 @import \"tailwindcss\"만으로도 tailwind 근거가 된다", async () => {
    repo({ "package.json": pkg(), "src/app.css": '@import "tailwindcss";\n' });
    const r = await detect(tmp);
    const tw = r.styling.methods.find((m) => m.name === "tailwind");
    expect(tw?.evidence).toEqual(['@import "tailwindcss" in src/app.css']);
  });

  it("Tailwind v3 CSS 지시어(@tailwind base|components|utilities)도 tailwind 근거가 된다", async () => {
    repo({ "package.json": pkg(), "src/index.css": "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n" });
    const r = await detect(tmp);
    const tw = r.styling.methods.find((m) => m.name === "tailwind");
    expect(tw?.evidence).toEqual(["@tailwind directive in src/index.css"]);
    expect(r.activeExtractors).toContain("tailwind");
  });

  it("루트 아래(apps/web)의 tailwind.config.*도 찾고, 기본 제외 디렉터리 안의 것은 무시한다", async () => {
    repo({
      "package.json": pkg(),
      "apps/web/tailwind.config.js": "module.exports = {}",
      "node_modules/some-pkg/tailwind.config.js": "module.exports = {}",
    });
    const r = await detect(tmp);
    expect(r.styling.methods.find((m) => m.name === "tailwind")?.evidence).toEqual(["apps/web/tailwind.config.js"]);
  });

  it("루트 package.json에 workspaces가 있으면 감지된 방식의 근거에 monorepo-root를 더한다", async () => {
    repo({
      "package.json": JSON.stringify({ name: "mono", private: true, workspaces: ["apps/*"] }),
      "apps/web/tailwind.config.ts": "export default {}",
    });
    const r = await detect(tmp);
    expect(r.styling.methods.find((m) => m.name === "tailwind")?.evidence).toEqual([
      "apps/web/tailwind.config.ts",
      "monorepo-root",
    ]);
  });

  it("pnpm-workspace.yaml이 있어도 monorepo-root 근거를 더한다 (Tailwind가 없어도 폴백 방식에 붙는다)", async () => {
    repo({ "package.json": pkg(), "pnpm-workspace.yaml": "packages:\n  - apps/*\n" });
    const r = await detect(tmp, undefined, { available: AVAILABLE });
    expect(r.styling.methods).toEqual([{ name: "inline-style", evidence: ["fallback", "monorepo-root"], share: 0 }]);
  });

  it("모노레포 표식이 없으면 monorepo-root 근거가 없다", async () => {
    repo({ "package.json": pkg({}, { tailwindcss: "^3" }), "tailwind.config.ts": "" });
    const r = await detect(tmp);
    expect(r.styling.methods.flatMap((m) => m.evidence)).not.toContain("monorepo-root");
  });

  it("inline-style, css-modules, styled, emotion 근거를 각각 감지한다", async () => {
    repo({
      "package.json": pkg({ "styled-components": "^6", "@emotion/react": "^11" }),
      "src/A.tsx": "export const A = () => <div style={{ color: 'red' }} />;",
      "src/B.module.css": ".b{}",
    });
    const r = await detect(tmp, undefined, { available: AVAILABLE });
    const names = r.styling.methods.map((m) => m.name);
    expect(names).toEqual(["inline-style", "css-modules", "styled", "emotion"]);
    expect(r.styling.methods.find((m) => m.name === "css-modules")?.evidence).toEqual(["src/B.module.css"]);
    expect(r.styling.methods.find((m) => m.name === "styled")?.evidence).toEqual(["package.json: styled-components"]);
    expect(r.styling.methods.find((m) => m.name === "emotion")?.evidence).toEqual(["package.json: @emotion/react"]);
    // 구현된 Extractor가 있는 방식만 active
    expect(r.activeExtractors).toEqual(["inline-style"]);
  });

  it("@emotion/css만 의존성에 있어도 emotion 방식을 감지하고 emotion Extractor를 활성화한다", async () => {
    repo({
      "package.json": pkg({ "@emotion/css": "^11" }),
      "src/A.tsx": 'import { css } from "@emotion/css";\nexport const A = () => <div className={css`color: red;`} />;',
    });
    const r = await detect(tmp, undefined, { available: [...AVAILABLE, meta("emotion")] });
    const emotion = r.styling.methods.find((m) => m.name === "emotion");
    expect(emotion?.evidence).toEqual(["package.json: @emotion/css"]);
    expect(emotion?.share).toBe(1);
    expect(r.activeExtractors).toContain("emotion");
  });

  it("css-modules·styled·emotion 근거만 있어도 activeExtractors는 inline-style로 폴백한다", async () => {
    repo({ "package.json": pkg({ "styled-components": "^6" }), "src/A.tsx": "export const A = 1;" });
    const r = await detect(tmp, undefined, { available: AVAILABLE });
    expect(r.activeExtractors).toEqual(["inline-style"]);
    expect(r.styling.methods.map((m) => m.name)).toEqual(["styled", "inline-style"]);
    expect(r.styling.methods.find((m) => m.name === "inline-style")?.evidence).toEqual(["fallback"]);
    expect(r.styling.methods.find((m) => m.name === "styled")?.evidence).toEqual(["package.json: styled-components"]);
  });

  it("근거가 하나도 없으면 inline-style을 fallback 근거와 함께 활성화한다", async () => {
    repo({ "package.json": pkg(), "src/A.tsx": "export const A = () => <div />;" });
    const r = await detect(tmp, undefined, { available: AVAILABLE });
    expect(r.styling.methods).toEqual([{ name: "inline-style", evidence: ["fallback"], share: 0 }]);
    expect(r.activeExtractors).toEqual(["inline-style"]);
  });

  it("(a) available 없이 호출하면 activeExtractors는 방식 이름 그대로이고 폴백이 없으며 extractorsResolved는 false", async () => {
    repo({ "package.json": pkg({ "styled-components": "^6" }), "src/A.tsx": "export const A = 1;" });
    const r = await detect(tmp);
    expect(r.activeExtractors).toEqual(["styled"]);
    expect(r.extractorsResolved).toBe(false);
    expect(r.styling.methods.map((m) => m.name)).toEqual(["styled"]);
  });

  it("available를 주면 extractorsResolved는 true", async () => {
    repo({ "package.json": pkg() });
    expect((await detect(tmp, undefined, { available: AVAILABLE })).extractorsResolved).toBe(true);
  });

  it("(b) available에 inline-style이 없으면 맞는 Extractor가 없어도 폴백하지 않는다", async () => {
    repo({ "package.json": pkg({ "styled-components": "^6" }), "src/A.tsx": "export const A = 1;" });
    const r = await detect(tmp, undefined, { available: [meta("tailwind")] });
    expect(r.activeExtractors).toEqual([]);
    expect(r.styling.methods.map((m) => m.name)).toEqual(["styled"]);
  });

  it("available에 있는 방식만 교집합으로 활성화한다 (방식 순서 유지)", async () => {
    repo({
      "package.json": pkg({ "styled-components": "^6" }, { tailwindcss: "^3" }),
      "src/A.tsx": "export const A = () => <div style={{ color: 'red' }} />;",
    });
    const r = await detect(tmp, undefined, { available: [meta("inline-style"), meta("styled"), meta("tailwind")] });
    expect(r.activeExtractors).toEqual(["tailwind", "inline-style", "styled"]);
  });

  it("교집합이 비면(css만 감지, available은 inline-style뿐) inline-style로 폴백하고 방식 목록에 fallback 항목을 더한다", async () => {
    repo({ "package.json": pkg(), "src/app.css": "a{color:red}" });
    const r = await detect(tmp, undefined, { available: [meta("inline-style")] });
    expect(r.activeExtractors).toEqual(["inline-style"]);
    expect(r.styling.methods.map((m) => m.name)).toEqual(["css", "inline-style"]);
    expect(r.styling.methods.find((m) => m.name === "inline-style")?.evidence).toEqual(["fallback"]);
  });

  it("(c) @mui/material 의존성과 sx={{ 가 있는 파일이 있으면 mui-sx 방식", async () => {
    repo({
      "package.json": pkg({ "@mui/material": "^6" }),
      "src/x.tsx": "export const X = () => <Box sx={{ p: 2 }} />;",
      "src/y.tsx": "export const Y = () => <Box />;",
    });
    const r = await detect(tmp);
    const sx = r.styling.methods.find((m) => m.name === "mui-sx");
    expect(sx?.evidence).toEqual(["package.json: @mui/material", "sx={{ in src/x.tsx"]);
    expect(sx?.share).toBe(0.5);
  });

  it("mui-sx는 @mui/joy 의존성도 인정하고, 의존성만 있고 sx={{ 가 없으면 감지하지 않는다", async () => {
    repo({ "package.json": pkg({ "@mui/joy": "^5" }), "src/x.tsx": "export const X = () => <Box sx={{ p: 2 }} />;" });
    expect((await detect(tmp)).styling.methods.find((m) => m.name === "mui-sx")?.evidence).toEqual([
      "package.json: @mui/joy",
      "sx={{ in src/x.tsx",
    ]);
    fs.rmSync(path.join(tmp, "src"), { recursive: true });
    repo({ "src/x.tsx": "export const X = () => <Box />;" });
    expect((await detect(tmp)).styling.methods.some((m) => m.name === "mui-sx")).toBe(false);
  });

  it("MUI 의존성 없이 sx={{ 만 있으면 mui-sx가 아니다", async () => {
    repo({ "package.json": pkg(), "src/x.tsx": "export const X = () => <Box sx={{ p: 2 }} />;" });
    expect((await detect(tmp)).styling.methods.some((m) => m.name === "mui-sx")).toBe(false);
  });

  it("(d) .module.이 아닌 css/scss 파일이 있으면 css 방식이고 근거는 파일 경로(최대 3개)", async () => {
    repo({
      "package.json": pkg(),
      "styles/app.css": "a{}",
      "styles/b.scss": "a{}",
      "styles/c.css": "a{}",
      "styles/d.css": "a{}",
      "node_modules/x/index.css": "a{}",
    });
    const r = await detect(tmp);
    expect(r.styling.methods.find((m) => m.name === "css")?.evidence).toEqual([
      "styles/app.css",
      "styles/b.scss",
      "styles/c.css",
    ]);
  });

  it("(d) .module.css만 있으면 css 방식이 없고 css-modules만 있다", async () => {
    repo({ "package.json": pkg(), "src/a.module.css": ".a{}", "src/b.module.scss": ".b{}" });
    const names = (await detect(tmp)).styling.methods.map((m) => m.name);
    expect(names).toContain("css-modules");
    expect(names).not.toContain("css");
  });

  it("index.extractors에 이름이 있는 모든 방식의 share는 index의 usage 비율 (css·mui-sx 포함)", async () => {
    repo({
      "package.json": pkg({ "@mui/material": "^6" }),
      "src/x.tsx": "export const X = () => <Box sx={{ p: 2 }} />;",
      "styles/app.css": "a{}",
    });
    const index: Index = {
      ...indexOf([style("css", "hardcoded"), style("css", "hardcoded"), style("mui-sx", "hardcoded"), style("inline-style", "hardcoded")], []),
      extractors: ["css", "mui-sx", "inline-style"],
    };
    const r = await detect(tmp, index);
    const share = (n: string) => r.styling.methods.find((m) => m.name === n)?.share;
    expect(share("css")).toBe(0.5);
    expect(share("mui-sx")).toBe(0.25);
  });

  it("폴백으로 만들어진 inline-style 항목의 share도 index에서 계산한다", async () => {
    repo({ "package.json": pkg() });
    const index = indexOf([style("inline-style", "hardcoded"), style("tailwind", "token")], []);
    const r = await detect(tmp, index, { available: AVAILABLE });
    expect(r.styling.methods).toEqual([{ name: "inline-style", evidence: ["fallback"], share: 0.5 }]);
  });
});

describe("ds 감지", () => {
  it("components/ui 디렉터리와 tokens.css가 있으면 local DS와 토큰 파일을 보고한다", async () => {
    repo({ "package.json": pkg(), "components/ui": null, "tokens.css": ":root{}" });
    const r = await detect(tmp);
    expect(r.ds.kind).toBe("local");
    expect(r.ds.dir).toBe("components/ui");
    expect(r.ds.tokenFiles).toEqual(["tokens.css"]);
  });

  it("@radix-ui/* 같은 의존성은 npm DS로 보고 packageName을 담는다", async () => {
    repo({ "package.json": pkg({ react: "^19", "@radix-ui/react-dialog": "^1" }) });
    const r = await detect(tmp);
    expect(r.ds).toEqual({
      kind: "npm",
      packageName: "@radix-ui/react-dialog",
      packageNames: ["@radix-ui/react-dialog"],
      tokenFiles: [],
    });
  });

  it("이름에 design-system, ui-kit 또는 /ui로 끝나는 패키지도 npm DS로 본다", async () => {
    for (const name of ["acme-design-system", "my-ui-kit", "@acme/ui"]) {
      fs.rmSync(path.join(tmp, "package.json"), { force: true });
      repo({ "package.json": pkg({ [name]: "1.0.0" }) });
      const r = await detect(tmp);
      expect(r.ds.kind, name).toBe("npm");
      expect(r.ds.packageName).toBe(name);
    }
  });

  it("DS 근거가 없으면 none이고, node_modules 안의 토큰 파일은 무시한다", async () => {
    repo({ "package.json": pkg(), "node_modules/x/tokens.css": "", "src/theme.ts": "export {}" });
    const r = await detect(tmp);
    expect(r.ds).toEqual({ kind: "none", tokenFiles: ["src/theme.ts"] });
  });
});

describe("ds 감지: 로컬 DS 우선 판정", () => {
  it("shadcn 패턴: radix 의존성 + components/ui/ → local, 로컬 디렉터리 import가 집계된다", async () => {
    repo({
      "package.json": pkg({ "@radix-ui/react-dialog": "^1", "@radix-ui/react-slot": "^1" }),
      "components/ui/button.tsx": "export const Button = () => null;",
      "src/A.tsx": "import { Button } from './components/ui/button';\nexport const A = () => <Button />;",
      "src/B.tsx": "export const B = () => <div />;",
    });
    const r = await detect(tmp);
    expect(r.ds.kind).toBe("local");
    expect(r.ds.dir).toBe("components/ui");
    const index = indexOf([], [comp("Button", "./components/ui/button"), comp("div", null)]);
    expect(sharesFromIndex(index, r.ds).dsImportShare).toBe(0.5);
    expect(sharesFromSources([{ file: "src/A.tsx", content: "import { Button } from './components/ui/button';" }], r.ds).dsImportShare).toBeGreaterThan(0);
  });

  it("@headlessui/ 같은 프리미티브만 있고 로컬 DS 디렉터리가 있어도 local", async () => {
    repo({ "package.json": pkg({ "@radix-ui/react-slot": "^1", "@headlessui/react": "^2" }), "src/ui": null });
    expect((await detect(tmp)).ds.kind).toBe("local");
  });

  it("완성된 DS 패키지(@mantine/*)가 있으면 로컬 디렉터리가 있어도 npm", async () => {
    repo({ "package.json": pkg({ "@radix-ui/react-slot": "^1", "@mantine/core": "^7" }), "components/ui": null });
    const r = await detect(tmp);
    expect(r.ds.kind).toBe("npm");
    expect(r.ds.packageNames).toEqual(["@radix-ui/react-slot", "@mantine/core"]);
  });

  it("(e) 대표 패키지는 icons·x-*·styled-engine·utils·system이 아닌 첫 패키지 (@mui/icons-material이 먼저 선언돼도 @mui/material)", async () => {
    repo({ "package.json": pkg({ "@mui/icons-material": "^6", "@mui/material": "^6" }) });
    const r = await detect(tmp);
    expect(r.ds.packageName).toBe("@mui/material");
    expect(r.ds.packageNames).toEqual(["@mui/icons-material", "@mui/material"]);
  });

  it("대표 패키지 후보가 모두 제외 대상이면 첫 번째 패키지", async () => {
    repo({ "package.json": pkg({ "@mui/icons-material": "^6", "@mui/system": "^6" }) });
    expect((await detect(tmp)).ds.packageName).toBe("@mui/icons-material");
  });

  it("프리미티브만 있고 로컬 디렉터리가 없으면 npm", async () => {
    repo({ "package.json": pkg({ "@radix-ui/react-slot": "^1" }) });
    expect((await detect(tmp)).ds.kind).toBe("npm");
  });

  it("npm DS의 import 비율은 DS로 판정된 모든 패키지를 센다 (@mui/material + @mui/icons-material)", async () => {
    repo({
      "package.json": pkg({ "@mui/material": "^6", "@mui/icons-material": "^6" }),
      "src/A.tsx": "import { Button } from '@mui/material';\nexport const A = () => <Button />;",
      "src/B.tsx": "import DeleteIcon from '@mui/icons-material/Delete';\nexport const B = () => <DeleteIcon />;",
      "src/C.tsx": "export const C = () => <div />;",
      "src/D.tsx": "export const D = () => <div />;",
    });
    const r = await detect(tmp);
    expect(r.ds.packageName).toBe("@mui/material");
    expect(r.ds.packageNames).toEqual(["@mui/material", "@mui/icons-material"]);
    // 파일 스캔: 4개 중 2개
    expect(sharesFromSources(await loadSources(tmp), r.ds).dsImportShare).toBe(0.5);
    // index: ComponentUsage 4개 중 2개(두 패키지 모두)
    const index = indexOf(
      [],
      [comp("Button", "@mui/material"), comp("DeleteIcon", "@mui/icons-material/Delete"), comp("X", "./X"), comp("Y", null)],
    );
    expect(sharesFromIndex(index, r.ds).dsImportShare).toBe(0.5);
  });
});

describe("framework / storybook / lint 감지", () => {
  it("next 의존성과 app/ 디렉터리면 next app router", async () => {
    repo({ "package.json": pkg({ next: "^15" }), app: null });
    expect((await detect(tmp)).framework).toEqual({ name: "next", router: "app" });
  });

  it("next + pages/만 있으면 pages router, 둘 다 없으면 router를 생략한다", async () => {
    repo({ "package.json": pkg({ next: "^15" }), "src/pages": null });
    expect((await detect(tmp)).framework).toEqual({ name: "next", router: "pages" });
    fs.rmSync(path.join(tmp, "src"), { recursive: true });
    expect((await detect(tmp)).framework).toEqual({ name: "next" });
  });

  it("react-native/expo는 react-native, vite는 vite, 그 외는 unknown", async () => {
    repo({ "package.json": pkg({ expo: "~52" }) });
    expect((await detect(tmp)).framework).toEqual({ name: "react-native" });
    repo({ "package.json": pkg({}, { vite: "^6" }) });
    expect((await detect(tmp)).framework).toEqual({ name: "vite" });
    repo({ "package.json": pkg() });
    expect((await detect(tmp)).framework).toEqual({ name: "unknown" });
  });

  it(".storybook/ 디렉터리가 있으면 storybook true", async () => {
    repo({ "package.json": pkg(), ".storybook": null });
    expect((await detect(tmp)).storybook).toBe(true);
  });

  it("*.stories.tsx 파일만 있어도 storybook true, 없으면 false", async () => {
    repo({ "package.json": pkg() });
    expect((await detect(tmp)).storybook).toBe(false);
    repo({ "src/Button.stories.tsx": "export default {}" });
    expect((await detect(tmp)).storybook).toBe(true);
  });

  it("eslint.config.js면 eslint와 설정 파일 경로", async () => {
    repo({ "package.json": pkg(), "eslint.config.js": "export default []" });
    expect((await detect(tmp)).lint).toEqual({ tool: "eslint", configFile: "eslint.config.js" });
  });

  it(".eslintrc.json, .oxlintrc.json, biome.json, 없음", async () => {
    repo({ "package.json": pkg(), ".eslintrc.json": "{}" });
    expect((await detect(tmp)).lint).toEqual({ tool: "eslint", configFile: ".eslintrc.json" });
    fs.rmSync(path.join(tmp, ".eslintrc.json"));
    repo({ ".oxlintrc.json": "{}" });
    expect((await detect(tmp)).lint).toEqual({ tool: "oxlint", configFile: ".oxlintrc.json" });
    fs.rmSync(path.join(tmp, ".oxlintrc.json"));
    repo({ "biome.jsonc": "{}" });
    expect((await detect(tmp)).lint).toEqual({ tool: "biome", configFile: "biome.jsonc" });
    fs.rmSync(path.join(tmp, "biome.jsonc"));
    expect((await detect(tmp)).lint).toEqual({ tool: "none" });
  });
});

describe("decideState", () => {
  it("DS 없음 → 0", () => {
    expect(decideState({ kind: "none", tokenFiles: [] }, 0, 0)).toBe(0);
    expect(decideState({ kind: "none", tokenFiles: [] }, 1, 0)).toBe(0);
  });

  it("DS가 있어도 import 비율이 낮으면 → 1", () => {
    expect(decideState({ kind: "npm", tokenFiles: [] }, 0.2, 0.1)).toBe(1);
  });

  it("DS가 있고 import 비율이 높아도 하드코딩이 많으면 → 1", () => {
    expect(decideState({ kind: "local", tokenFiles: [] }, 0.9, 0.5)).toBe(1);
  });

  it("DS가 있고 import 비율이 높고 하드코딩이 적으면 → 2", () => {
    expect(decideState({ kind: "npm", tokenFiles: [] }, 0.8, 0.1)).toBe(2);
  });

  it("경계값: dsImportShare 0.5, hardcodedShare 0.3은 → 2", () => {
    expect(decideState({ kind: "npm", tokenFiles: [] }, 0.5, 0.3)).toBe(2);
  });
});

describe("overrides", () => {
  it("기존 detect.json의 overrides.state가 재감지 결과에 적용되고 overrides가 보존된다", async () => {
    repo({ "package.json": pkg() });
    const first = await detect(tmp);
    expect(first.state).toBe(0);
    await writeDetect(tmp, { ...first, overrides: { state: 2 } });
    const again = await detect(tmp);
    expect(again.state).toBe(2);
    expect(again.overrides).toEqual({ state: 2 });
  });

  it("overrides.activeExtractors와 overrides.ds도 적용되고, ds override는 state 계산에 반영된다", async () => {
    repo({ "package.json": pkg(), "src/A.tsx": "export const A = () => <div />;" });
    const first = await detect(tmp);
    await writeDetect(tmp, {
      ...first,
      overrides: {
        activeExtractors: ["tailwind"],
        ds: { kind: "npm", packageName: "acme-ui-kit", tokenFiles: [] },
      },
    });
    const again = await detect(tmp);
    expect(again.activeExtractors).toEqual(["tailwind"]);
    expect(again.ds.packageName).toBe("acme-ui-kit");
    // provisional 추정: DS import 0% → 1
    expect(again.state).toBe(1);
  });

  it("overrides.activeExtractors의 예전 이름 sx는 mui-sx로 바꿔 적용하고, 파일의 overrides는 그대로 보존한다", async () => {
    repo({ "package.json": pkg(), "src/A.tsx": "export const A = () => <div />;" });
    const first = await detect(tmp);
    await writeDetect(tmp, { ...first, overrides: { activeExtractors: ["emotion", "sx", "mui-sx"] } });
    const again = await detect(tmp);
    expect(again.activeExtractors).toEqual(["emotion", "mui-sx"]);
    expect(again.overrides).toEqual({ activeExtractors: ["emotion", "sx", "mui-sx"] });
  });

  it("overrides가 없으면 기존 파일과 무관하게 새로 감지한다", async () => {
    repo({ "package.json": pkg() });
    const first = await detect(tmp);
    await writeDetect(tmp, { ...first, state: 2 });
    expect((await detect(tmp)).state).toBe(0);
  });
});

describe("손상된 입력과 빈 레포", () => {
  it("package.json이 손상되면 오류 메시지에 package.json이 들어간다", async () => {
    repo({ "package.json": "{ not json" });
    await expect(detect(tmp)).rejects.toThrow(/package\.json: /);
  });

  it("detect.json이 손상되면 오류 메시지에 .dsmith/detect.json이 들어간다", async () => {
    repo({ "package.json": pkg(), ".dsmith/detect.json": "{ not json" });
    await expect(readDetect(tmp)).rejects.toThrow(/\.dsmith\/detect\.json: /);
    await expect(detect(tmp)).rejects.toThrow(/detect\.json: /);
  });

  it("dependencies가 객체가 아니어도 빈 것으로 취급한다", async () => {
    repo({ "package.json": JSON.stringify({ dependencies: ["next"], devDependencies: null }) });
    const r = await detect(tmp);
    expect(r.framework).toEqual({ name: "unknown" });
  });

  it("완전히 빈 디렉터리: state 0, provisional true, 예외 없음", async () => {
    const r = await detect(tmp, undefined, { available: AVAILABLE });
    expect(r.state).toBe(0);
    expect(r.provisional).toBe(true);
    expect(r.activeExtractors).toEqual(["inline-style"]);
  });

  it("package.json 없이 소스만 있는 디렉터리도 같은 결과", async () => {
    repo({ "src/A.tsx": "export const A = () => <div />;" });
    const r = await detect(tmp);
    expect(r.state).toBe(0);
    expect(r.provisional).toBe(true);
    expect(r.ds.kind).toBe("none");
  });

  it("존재하지 않는 root는 경로를 담은 명확한 오류를 던진다", async () => {
    const missing = path.join(tmp, "nope");
    await expect(detect(missing)).rejects.toThrow(missing);
  });
});

describe("store", () => {
  it("readDetect는 파일이 없으면 null", async () => {
    expect(await readDetect(tmp)).toBeNull();
  });

  it("writeDetect는 .dsmith/detect.json에 쓰고 절대 경로를 반환하며 readDetect가 동일하게 읽는다", async () => {
    repo({ "package.json": pkg() });
    const r = await detect(tmp);
    const written = await writeDetect(tmp, r);
    expect(written).toBe(path.join(tmp, ".dsmith", "detect.json"));
    expect(fs.readFileSync(written, "utf-8")).toContain('\n  "version": 1');
    expect(await readDetect(tmp)).toEqual(r);
  });
});

describe("index 없이(provisional) 감지", () => {
  it("provisional true, 방식별 share는 마커가 있는 파일 비율", async () => {
    repo({
      "package.json": pkg({}, { tailwindcss: "^3" }),
      "src/A.tsx": 'export const A = () => <div className="p-4" />;',
      "src/B.tsx": "export const B = () => <div style={{ color: 'red' }} />;",
      "src/C.tsx": "export const C = () => <div />;",
      "src/d.ts": "export const d = 1;",
    });
    const r = await detect(tmp);
    expect(r.provisional).toBe(true);
    const share = (n: string) => r.styling.methods.find((m) => m.name === n)?.share;
    expect(share("tailwind")).toBe(0.25);
    expect(share("inline-style")).toBe(0.25);
  });

  it("evidence만 있고 마커 파일이 없는 방식은 share 0", async () => {
    repo({ "package.json": pkg({ "styled-components": "^6" }), "src/A.tsx": "export const A = 1;" });
    const r = await detect(tmp, undefined, { available: AVAILABLE });
    // 구현된 Extractor가 없으므로 inline-style 폴백이 함께 붙는다
    expect(r.styling.methods).toEqual([
      { name: "styled", evidence: ["package.json: styled-components"], share: 0 },
      { name: "inline-style", evidence: ["fallback"], share: 0 },
    ]);
  });

  it("하드코딩·DS import 비율은 파일 스캔으로 추정되어 state에 반영된다 (DS import 높고 하드코딩 낮음 → 2)", async () => {
    repo({
      "package.json": pkg({ "@acme/ui": "1.0.0" }),
      "src/A.tsx": "import { Button } from '@acme/ui';\nexport const A = () => <Button />;",
      "src/B.tsx": "import { Card } from '@acme/ui/card';\nexport const B = () => <Card />;",
    });
    const r = await detect(tmp);
    expect(r.provisional).toBe(true);
    expect(r.state).toBe(2);
  });

  it("하드코딩 hex 색상 파일이 많으면 → 1", async () => {
    repo({
      "package.json": pkg({ "@acme/ui": "1.0.0" }),
      "src/A.tsx": "import { Button } from '@acme/ui';\nexport const A = () => <Button />;",
      "src/B.tsx": "export const B = () => <div style={{ color: '#ff0000' }} />;",
    });
    const r = await detect(tmp);
    // dsImportShare 0.5, hardcodedShare 0.5 > 0.3
    expect(r.state).toBe(1);
  });

  it("local DS는 dir을 가리키는 import 지정자로 import 비율을 센다", async () => {
    repo({
      "package.json": pkg(),
      "src/components/ui/button.tsx": "export const Button = () => null;",
      "src/A.tsx": "import { Button } from '@/components/ui/button';\nexport const A = () => <Button />;",
      "src/B.tsx": "import { Button } from '../components/ui/button';\nexport const B = () => <Button />;",
    });
    const r = await detect(tmp);
    expect(r.ds.dir).toBe("src/components/ui");
    expect(r.state).toBe(2);
  });

  it("DS가 없으면 state 0", async () => {
    repo({ "package.json": pkg(), "src/A.tsx": "export const A = () => <div style={{ color: '#fff' }} />;" });
    expect((await detect(tmp)).state).toBe(0);
  });
});

describe("index와 함께 감지", () => {
  it("provisional false, tailwind/inline-style share는 Extractor별 usage 비율", async () => {
    repo({
      "package.json": pkg({}, { tailwindcss: "^3" }),
      "src/A.tsx": "export const A = () => <div style={{ color: 'red' }} className=\"p-4\" />;",
      "src/B.module.css": ".b{}",
    });
    const index = indexOf(
      [
        style("tailwind", "tailwind-default"),
        style("tailwind", "token"),
        style("tailwind", "hardcoded"),
        style("inline-style", "hardcoded"),
      ],
      [],
    );
    const r = await detect(tmp, index);
    expect(r.provisional).toBe(false);
    const share = (n: string) => r.styling.methods.find((m) => m.name === n)?.share;
    expect(share("tailwind")).toBe(0.75);
    expect(share("inline-style")).toBe(0.25);
    // Extractor가 없는 방식은 evidence 기반 share(파일 스캔)를 유지한다: .module.css import 파일 없음 → 0
    expect(share("css-modules")).toBe(0);
  });

  it("sharesFromIndex: hardcoded/(hardcoded+tailwind-default+token), dynamic은 분모에서 제외", () => {
    const index = indexOf(
      [
        style("tailwind", "hardcoded"),
        style("tailwind", "tailwind-default"),
        style("tailwind", "token"),
        style("tailwind", "token"),
        style("inline-style", "dynamic"),
      ],
      [],
    );
    const ds = { kind: "npm", packageName: "@acme/ui", tokenFiles: [] } as const;
    expect(sharesFromIndex(index, ds).hardcodedShare).toBe(0.25);
  });

  it("sharesFromIndex: property other(display·opacity)와 정규화 안 된 hardcoded 값은 비율을 움직이지 않는다", () => {
    const ds = { kind: "none", tokenFiles: [] } as const;
    const base = [style("inline-style", "hardcoded"), style("inline-style", "token")];
    const unnormalized: StyleUsage = { ...style("tailwind", "hardcoded"), property: "height", normalized: { kind: "unknown" } };
    expect(sharesFromIndex(indexOf(base, []), ds).hardcodedShare).toBe(0.5);
    expect(
      sharesFromIndex(indexOf([...base, layoutStyle("flex"), layoutStyle("0.5"), unnormalized], []), ds).hardcodedShare,
    ).toBe(0.5);
  });

  it("sharesFromIndex: 분모가 0이면 0", () => {
    const ds = { kind: "npm", packageName: "@acme/ui", tokenFiles: [] } as const;
    expect(sharesFromIndex(indexOf([], []), ds)).toEqual({ hardcodedShare: 0, dsImportShare: 0, rated: 0 });
  });

  it("sharesFromIndex: npm은 importedFrom이 패키지명(또는 하위 경로)과 같은 ComponentUsage 비율", () => {
    const ds = { kind: "npm", packageName: "@acme/ui", tokenFiles: [] } as const;
    const index = indexOf(
      [],
      [comp("Button", "@acme/ui"), comp("Card", "@acme/ui/card"), comp("Foo", "./Foo"), comp("div", null)],
    );
    expect(sharesFromIndex(index, ds).dsImportShare).toBe(0.5);
  });

  it("sharesFromIndex: local은 importedFrom이 DS 디렉터리로 시작하는 비율 (@/, 상대경로, src/ 접두 허용)", () => {
    const ds = { kind: "local", dir: "src/components/ui", tokenFiles: [] } as const;
    const index = indexOf(
      [],
      [
        comp("Button", "@/components/ui/button"),
        comp("Card", "../components/ui/card"),
        comp("Modal", "src/components/ui/modal"),
        comp("Header", "@/components/header"),
      ],
    );
    expect(sharesFromIndex(index, ds).dsImportShare).toBe(0.75);
  });

  it("sharesFromIndex: importedFrom이 아니라 module로 DS 여부를 본다 (tsconfig paths 별칭)", () => {
    const ds = { kind: "local", dir: "src/components/ui", tokenFiles: [] } as const;
    const index = indexOf(
      [],
      [comp("Button", "ui/button", "src/components/ui/button"), comp("Header", null, "")],
    );
    expect(sharesFromIndex(index, ds).dsImportShare).toBe(0.5);
  });

  it("sharesFromIndex: module이 DS가 아니어도 importedFrom이 DS를 가리키면 DS import로 센다(안전망)", () => {
    const local = { kind: "local", dir: "src/components/ui", tokenFiles: [] } as const;
    // baseUrl 해석이 없던 index.json: module은 패키지 규칙으로 "components"가 됐다.
    const index = indexOf([], [comp("Button", "components/ui/button", "components"), comp("Header", "./Header")]);
    expect(sharesFromIndex(index, local).dsImportShare).toBe(0.5);
    const npm = { kind: "npm", packageName: "@acme/ui", packageNames: ["@acme/ui"], tokenFiles: [] } as const;
    const mono = indexOf([], [comp("Button", "@acme/ui", "../../packages/ui/src"), comp("Header", null)]);
    expect(sharesFromIndex(mono, npm).dsImportShare).toBe(0.5);
  });

  it("baseUrl 전용 레포(src/components/ui): bare import가 로컬 DS import로 집계된다", async () => {
    repo({
      "package.json": pkg({ react: "^18" }),
      "tsconfig.json": `{ "compilerOptions": { "baseUrl": "src" } }`,
      "src/components/ui/button.tsx": "export const Button = () => <button />;",
      "src/pages/home.tsx": "import { Button } from 'components/ui/button';\nexport const H = () => <Button />;",
    });
    const index = await indexRepo(tmp, []);
    expect(index.components.map((c) => c.module)).toEqual(["src/components/ui/button"]);
    const r = await detect(tmp, index);
    expect(r.ds).toMatchObject({ kind: "local", dir: "src/components/ui" });
    expect(sharesFromIndex(index, r.ds).dsImportShare).toBe(1);
  });

  it("모노레포 앱(paths가 ../../packages/ui를 가리킴): 루트·서브패스 import 모두 npm DS import로 집계된다", async () => {
    repo({
      "package.json": pkg({ "@acme/ui": "workspace:*" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          paths: { "@acme/ui": ["../../packages/ui/src/index.ts"], "@acme/ui/*": ["../../packages/ui/src/*"] },
        },
      }),
      "src/A.tsx": "import { Button } from '@acme/ui';\nexport const A = () => <Button />;",
      "src/B.tsx": "import { Button } from '@acme/ui/button';\nexport const B = () => <Button />;",
    });
    const index = await indexRepo(tmp, []);
    expect(index.components.map((c) => c.module)).toEqual(["@acme/ui", "@acme/ui"]);
    const r = await detect(tmp, index);
    expect(r.ds).toMatchObject({ kind: "npm", packageName: "@acme/ui" });
    expect(sharesFromIndex(index, r.ds).dsImportShare).toBe(1);
  });

  it("sharesFromIndex: DS 없음이면 dsImportShare 0", () => {
    const index = indexOf([], [comp("Button", "@acme/ui")]);
    expect(sharesFromIndex(index, { kind: "none", tokenFiles: [] }).dsImportShare).toBe(0);
  });

  it("index의 shares로 state를 판정한다 (DS import 낮음 → 1, 높음 → 2)", async () => {
    repo({ "package.json": pkg({ "@acme/ui": "1" }) });
    const low = await detect(
      tmp,
      indexOf([style("tailwind", "token")], [comp("Button", "@acme/ui"), comp("A", "./A"), comp("B", "./B")]),
    );
    expect(low.state).toBe(1);
    const high = await detect(
      tmp,
      indexOf([style("tailwind", "token")], [comp("Button", "@acme/ui"), comp("Card", "@acme/ui")]),
    );
    expect(high.state).toBe(2);
  });
});
