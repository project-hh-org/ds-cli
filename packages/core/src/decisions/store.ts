import fs from "node:fs/promises";
import path from "node:path";
import type { DecisionRecord, DecisionsFile } from "./model.js";

const DECISIONS_DIR = ".dsmith";
const DECISIONS_FILE = "decisions.json";
const DISPLAY_PATH = `${DECISIONS_DIR}/${DECISIONS_FILE}`;

function decisionsPath(root: string): string {
  return path.join(root, DECISIONS_DIR, DECISIONS_FILE);
}

function isDecisionsFile(value: unknown): value is DecisionsFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { version?: unknown; items?: unknown };
  return v.version === 1 && Array.isArray(v.items);
}

/** `<root>/.dsmith/decisions.json`을 읽는다. 없으면 빈 파일. 깨졌거나 모양이 틀리면 파일명을 담은 에러. */
export async function readDecisions(root: string): Promise<DecisionsFile> {
  let text: string;
  try {
    text = await fs.readFile(decisionsPath(root), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, items: [] };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${DISPLAY_PATH}를 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isDecisionsFile(parsed)) {
    throw new Error(`${DISPLAY_PATH}의 모양이 올바르지 않습니다: { "version": 1, "items": [...] } 이어야 합니다`);
  }
  return parsed;
}

/** `.dsmith/`를 만들고 decisions.json을 쓴 뒤 쓴 경로를 반환한다. */
export async function writeDecisions(root: string, file: DecisionsFile): Promise<string> {
  const target = decisionsPath(root);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  return target;
}

/** (item, kind) 기준 upsert. 입력을 바꾸지 않는다. 기존 항목은 제자리에서 바뀌고 새 항목은 뒤에 붙는다. */
export function recordDecision(file: DecisionsFile, record: DecisionRecord): DecisionsFile {
  const at = file.items.findIndex((r) => r.item === record.item && r.kind === record.kind);
  const items = file.items.slice();
  if (at === -1) items.push(record);
  else items[at] = record;
  return { version: 1, items };
}
