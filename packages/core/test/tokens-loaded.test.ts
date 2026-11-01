import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOKENS_NOT_LOADED_NOTE, findTokensStylesheetImport } from "../src/tokens/tokens-loaded.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-tokens-loaded-"));
  put("design-system/tokens.css", ":root { --color-blue-400: #3b82f6; }\n");
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function put(rel: string, text: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

describe("findTokensStylesheetImport", () => {
  it("아무도 import하지 않으면 loaded false·evidence null", async () => {
    put("app/layout.tsx", 'import "./globals.css";\nexport default function L() { return null; }\n');
    put("app/globals.css", "body { margin: 0; }\n");
    expect(await findTokensStylesheetImport(root, { initDir: "design-system" })).toEqual({ css: false, evidence: null });
  });

  it("JS import 상대 경로(app/layout.tsx)", async () => {
    put("app/layout.tsx", 'import "../design-system/tokens.css";\n');
    expect(await findTokensStylesheetImport(root, { initDir: "design-system" })).toEqual({ css: true, evidence: "app/layout.tsx" });
  });

  it("CSS @import (따옴표·url())", async () => {
    put("src/globals.css", '@import url("../design-system/tokens.css");\nbody { margin: 0; }\n');
    expect(await findTokensStylesheetImport(root, { initDir: "design-system" })).toEqual({ css: true, evidence: "src/globals.css" });
  });

  it("HTML <link>와 별칭·절대 경로 지정자", async () => {
    put("index.html", '<link rel="stylesheet" href="/design-system/tokens.css">\n');
    expect(await findTokensStylesheetImport(root, { initDir: "design-system" })).toEqual({ css: true, evidence: "index.html" });
    fs.rmSync(path.join(root, "index.html"));
    put("src/main.tsx", 'import "@/design-system/tokens.css";\n');
    expect(await findTokensStylesheetImport(root, { initDir: "design-system" })).toEqual({ css: true, evidence: "src/main.tsx" });
  });

  it("주석 안의 import와 다른 디렉터리의 tokens.css는 세지 않는다", async () => {
    put("app/layout.tsx", '// import "../design-system/tokens.css";\n/* @import "../design-system/tokens.css" */\nimport "../other/tokens.css";\n');
    put("src/a.css", '/* @import "../design-system/tokens.css"; */\n');
    expect((await findTokensStylesheetImport(root, { initDir: "design-system" })).css).toBe(false);
  });

  it("제외 경로(node_modules·exclude)의 import는 세지 않는다", async () => {
    put("node_modules/x/index.js", 'import "../../design-system/tokens.css";\n');
    put("legacy/a.css", '@import "../design-system/tokens.css";\n');
    expect((await findTokensStylesheetImport(root, { initDir: "design-system", exclude: ["legacy/**"] })).css).toBe(false);
  });

  it("init 디렉터리 안의 테마 CSS는 테마가 연결됐을 때만 세고, 그 자신(tokens.css)은 세지 않는다", async () => {
    put("design-system/tailwind.theme.css", '@import "./tokens.css";\n@theme inline { --color-ds-blue-400: var(--color-blue-400); }\n');
    expect((await findTokensStylesheetImport(root, { initDir: "design-system" })).css).toBe(false);
    expect(await findTokensStylesheetImport(root, { initDir: "design-system", themeLinked: true })).toEqual({
      css: true,
      evidence: "design-system/tailwind.theme.css",
    });
  });

  it("안내 문장에 initDir과 전역 엔트리 예시가 들어간다", () => {
    expect(TOKENS_NOT_LOADED_NOTE("design-system")).toBe(
      "토큰 스타일시트가 로드되지 않음: design-system/tokens.css를 전역 엔트리(예: app/layout.tsx, src/main.tsx, globals.css)에서 import하세요 — 치환된 var()가 비어 보입니다",
    );
    expect(TOKENS_NOT_LOADED_NOTE(".")).toContain(": tokens.css를");
  });
});
