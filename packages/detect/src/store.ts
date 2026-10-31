import fs from "node:fs/promises";
import path from "node:path";
import type { DetectResult } from "./index.js";

const DIR = ".ds-cli";
const FILE = "detect.json";

function detectPath(root: string): string {
  return path.join(root, DIR, FILE);
}

/** `<root>/.ds-cli/detect.json`을 읽는다. 파일이 없으면 null. */
export async function readDetect(root: string): Promise<DetectResult | null> {
  let text: string;
  try {
    text = await fs.readFile(detectPath(root), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(text) as DetectResult;
}

/** `.ds-cli/`를 만들고 detect.json을 쓴 뒤 쓴 경로를 반환한다. */
export async function writeDetect(root: string, r: DetectResult): Promise<string> {
  const file = detectPath(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(r, null, 2)}\n`, "utf-8");
  return file;
}
