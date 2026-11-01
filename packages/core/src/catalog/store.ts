import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/safe-write.js";
import type { Catalog } from "./model.js";

export const CATALOG_FILE = ".dsmith/catalog.json";

function catalogPath(root: string): string {
  return path.join(root, ...CATALOG_FILE.split("/"));
}

/** `<root>/.dsmith/catalog.json`을 읽는다. 없으면 null. 깨진 파일은 CATALOG_FILE이 든 Error. */
export async function readCatalog(root: string): Promise<Catalog | null> {
  let text: string;
  try {
    text = await fs.readFile(catalogPath(root), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${CATALOG_FILE}을 JSON으로 읽을 수 없음`);
  }
  const c = parsed as Partial<Catalog> | null;
  if (c === null || typeof c !== "object" || c.version !== 1 || !Array.isArray(c.components)) {
    throw new Error(`${CATALOG_FILE} 형식이 올바르지 않음(version 1·components 배열 필요)`);
  }
  return c as Catalog;
}

/** `.dsmith/catalog.json`을 원자적으로 쓰고 절대 경로를 반환한다. */
export async function writeCatalog(root: string, catalog: Catalog): Promise<string> {
  const file = catalogPath(root);
  await atomicWrite(file, `${JSON.stringify(catalog, null, 2)}\n`);
  return file;
}
