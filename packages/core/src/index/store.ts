import fs from "node:fs/promises";
import path from "node:path";
import type { Index } from "./indexer.js";

const INDEX_DIR = ".dsmith";
const INDEX_FILE = "index.json";

function indexPath(root: string): string {
  return path.join(root, INDEX_DIR, INDEX_FILE);
}

/** `<root>/.dsmith/index.json`을 읽는다. 파일이 없으면 null. */
export async function readIndex(root: string): Promise<Index | null> {
  let text: string;
  try {
    text = await fs.readFile(indexPath(root), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(text) as Index;
}

/** `.dsmith/`를 만들고 index.json을 쓴 뒤 쓴 경로를 반환한다. */
export async function writeIndex(root: string, index: Index): Promise<string> {
  const file = indexPath(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
  return file;
}
