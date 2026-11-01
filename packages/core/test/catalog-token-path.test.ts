import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCatalogTokens } from "../src/catalog/tokens.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-cattok-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("readCatalogTokens: path", () => {
  it("W3C 토큰은 path를 싣고 CSS 변수 토큰은 path 키가 없다", async () => {
    fs.writeFileSync(path.join(root, "tokens.json"), JSON.stringify({ color: { "gray-50": { $type: "color", $value: "#f9fafb" } } }));
    fs.writeFileSync(path.join(root, "theme.css"), ":root { --brand: #3b82f6; }\n");
    const r = await readCatalogTokens(root, ["tokens.json", "theme.css"]);
    const gray = r.tokens.find((t) => t.name === "--color-gray-50");
    const brand = r.tokens.find((t) => t.name === "--brand");
    expect(gray).toMatchObject({ path: "color.gray-50", file: "tokens.json" });
    expect(brand).toBeDefined();
    expect("path" in brand!).toBe(false);
  });
});
