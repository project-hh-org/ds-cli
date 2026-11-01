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
  const index = JSON.parse(text) as Index;
  // module 필드 이전에 쓴 index.json: 원래 specifier를 알 수 없어(해석된 경로와 패키지 서브패스를 구분할 수 없다)
  // importedFrom을 그대로 module로 쓴다. 서브패스가 남을 수 있지만 isDsSpecifier는 서브패스도 DS로 본다.
  for (const c of index.components as (Omit<Index["components"][number], "module"> & { module?: string })[]) {
    c.module ??= c.importedFrom ?? "";
  }
  return index;
}

/** `.dsmith/`를 만들고 index.json을 쓴 뒤 쓴 경로를 반환한다. */
export async function writeIndex(root: string, index: Index): Promise<string> {
  const file = indexPath(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
  return file;
}
