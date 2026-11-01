import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Catalog } from "../src/catalog/model.js";
import { writeCatalog } from "../src/catalog/store.js";
import { readCatalogTokens, withTokenFiles } from "../src/catalog/tokens.js";
import { loadReplacementTokens } from "../src/tokens/replacement-tokens.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-reptok-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function put(rel: string, text: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const CSS = ":root { --color-blue-400: #3b82f6; --space-2: 8px; }\n";
const JSON_TOKENS = JSON.stringify({
  color: { "blue-400": { $type: "color", $value: { colorSpace: "srgb", components: [0.23, 0.51, 0.96], hex: "#3b82f6" } } },
  space: { "2": { $type: "dimension", $value: { value: 8, unit: "px" } } },
});

async function writeFreshCatalog(tokenFile: string): Promise<void> {
  const read = await readCatalogTokens(root, [tokenFile]);
  const catalog: Catalog = {
    version: 1,
    dsmith: "0.0.0",
    sources: withTokenFiles([{ origin: "ds-local", dir: "src/ds" }], read.files, null),
    components: [],
    tokens: read.tokens,
    stats: { components: 0, propsOk: 0, deprecated: 0, tokens: read.tokens.length },
  };
  await writeCatalog(root, catalog);
}

describe("loadReplacementTokens", () => {
  it("init 산출만 있고 detect tokenFiles가 비어도 token-file, excludeDirs [design-system]", async () => {
    put("design-system/tokens.json", JSON_TOKENS);
    put("design-system/tokens.css", CSS);
    put("design-system/tokens.ts", "export const tokens = {};\n");
    const r = await loadReplacementTokens(root, []);
    expect(r.source).toBe("token-file");
    expect(r.tokens.length).toBeGreaterThan(0);
    expect(r.tokens.every((t) => t.source === "token-file")).toBe(true);
    expect(r.excludeDirs).toEqual(["design-system"]);
    expect(r.files).toEqual(expect.arrayContaining(["design-system/tokens.css", "design-system/tokens.json"]));
    expect(r.excludeFiles).toEqual(r.files);
  });

  it("detect tokenFiles의 토큰 파일을 읽는다(init 산출 없음 → excludeDirs 비어 있음)", async () => {
    put("src/theme.css", CSS);
    const r = await loadReplacementTokens(root, ["src/theme.css"]);
    expect(r.source).toBe("token-file");
    expect(r.files).toEqual(["src/theme.css"]);
    expect(r.excludeDirs).toEqual([]);
    expect(r.tokens.map((t) => t.name).sort()).toEqual(["--color-blue-400", "--space-2"]);
  });

  it("토큰 파일 없음 + 신선한 카탈로그 → catalog", async () => {
    put("src/theme.css", CSS);
    await writeFreshCatalog("src/theme.css");
    // detect는 이 파일을 모른다(tokenFiles []) — 카탈로그만 안다
    const r = await loadReplacementTokens(root, []);
    expect(r.source).toBe("catalog");
    expect(r.tokens.every((t) => t.source === "catalog")).toBe(true);
    expect(r.files).toEqual(["src/theme.css"]);
    expect(r.excludeFiles).toEqual(["src/theme.css"]);
  });

  it("카탈로그 토큰 파일 해시가 어긋나면 none", async () => {
    put("src/theme.css", CSS);
    await writeFreshCatalog("src/theme.css");
    put("src/theme.css", CSS.replace("#3b82f6", "#111111"));
    const r = await loadReplacementTokens(root, []);
    expect(r.source).toBe("none");
    expect(r.tokens).toEqual([]);
    expect(r.warnings.join("\n")).toContain("src/theme.css");
  });

  it("토큰 파일도 카탈로그도 없으면 none — 제안 토큰은 어떤 경우에도 없다", async () => {
    put("src/a.tsx", 'export const A = () => <div style={{ color: "#3b82f6", padding: 8 }} />;\n');
    const r = await loadReplacementTokens(root, []);
    expect(r).toMatchObject({ source: "none", tokens: [], files: [], excludeFiles: [], excludeDirs: [] });
  });

  it("토큰 파일이 읽히면 카탈로그가 있어도 토큰 파일이 이긴다", async () => {
    put("src/theme.css", CSS);
    await writeFreshCatalog("src/theme.css");
    const r = await loadReplacementTokens(root, ["src/theme.css"]);
    expect(r.source).toBe("token-file");
  });
});
