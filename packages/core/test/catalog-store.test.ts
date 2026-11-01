import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Catalog } from "../src/catalog/model.js";
import { CATALOG_FILE, readCatalog, writeCatalog } from "../src/catalog/store.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-catalog-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const sample: Catalog = {
  version: 1,
  dsmith: "0.1.0",
  sources: [{ origin: "ds-local", dir: "src/components/ui" }],
  components: [
    {
      name: "Button",
      module: "src/components/ui/button",
      origin: "ds-local",
      file: "src/components/ui/button.tsx",
      props: [{ name: "variant", type: "keyof typeof variants", required: false, values: ["default"] }],
      propsStatus: "ok",
    },
  ],
  tokens: [],
  stats: { components: 1, propsOk: 1, deprecated: 0, tokens: 0 },
};

describe("catalog store", () => {
  it("없으면 null", async () => {
    expect(await readCatalog(root)).toBeNull();
  });
  it("쓰고 읽으면 같다(JSON 2칸 + 개행)", async () => {
    const file = await writeCatalog(root, sample);
    expect(file).toBe(path.join(root, ".dsmith", "catalog.json"));
    expect(fs.readFileSync(file, "utf-8")).toBe(`${JSON.stringify(sample, null, 2)}\n`);
    expect(await readCatalog(root)).toEqual(sample);
  });
  it("version이 1이 아니거나 components가 배열이 아니면 CATALOG_FILE이 든 에러", async () => {
    fs.mkdirSync(path.join(root, ".dsmith"));
    const f = path.join(root, ".dsmith", "catalog.json");
    fs.writeFileSync(f, JSON.stringify({ version: 2, components: [] }));
    await expect(readCatalog(root)).rejects.toThrow(CATALOG_FILE);
    fs.writeFileSync(f, JSON.stringify({ version: 1, components: {} }));
    await expect(readCatalog(root)).rejects.toThrow(CATALOG_FILE);
    fs.writeFileSync(f, "{ nope");
    await expect(readCatalog(root)).rejects.toThrow(CATALOG_FILE);
  });
});
