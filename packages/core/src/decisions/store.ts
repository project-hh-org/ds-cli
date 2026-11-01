import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/safe-write.js";
import type { DecisionRecord, DecisionsFile } from "./model.js";

const DECISIONS_DIR = ".dsmith";
const DECISIONS_FILE = "decisions.json";
const DISPLAY_PATH = `${DECISIONS_DIR}/${DECISIONS_FILE}`;

function decisionsPath(root: string): string {
  return path.join(root, DECISIONS_DIR, DECISIONS_FILE);
}

const KINDS: readonly string[] = ["duplicate", "local-definition", "token-cluster"];
const STATUSES: readonly string[] = ["pending", "decided"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 기록 하나의 모양 검사. 문제가 없으면 null, 있으면 사유. */
function recordProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return "객체가 아님";
  if (typeof value.item !== "string" || value.item === "") return "item은 비지 않은 문자열이어야 함";
  if (typeof value.kind !== "string" || !KINDS.includes(value.kind)) return `kind는 ${KINDS.join(" | ")} 중 하나여야 함`;
  if (typeof value.status !== "string" || !STATUSES.includes(value.status)) return `status는 ${STATUSES.join(" | ")} 중 하나여야 함`;
  if (!Array.isArray(value.options) || !value.options.every((o) => typeof o === "string")) return "options는 문자열 배열이어야 함";
  for (const key of ["chosen", "note", "decidedAt"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") return `${key}는 문자열이어야 함`;
  }
  if (value.mapping !== undefined) {
    if (!isPlainObject(value.mapping) || !Object.values(value.mapping).every((v) => typeof v === "string")) {
      return "mapping은 문자열 값의 객체여야 함";
    }
  }
  return null;
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
  if (!isPlainObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items)) {
    throw new Error(`${DISPLAY_PATH}의 모양이 올바르지 않습니다: { "version": 1, "items": [...] } 이어야 합니다`);
  }
  for (const [i, record] of parsed.items.entries()) {
    const problem = recordProblem(record);
    if (problem !== null) throw new Error(`${DISPLAY_PATH}의 items[${i}]가 올바르지 않습니다: ${problem}`);
  }
  return parsed as unknown as DecisionsFile;
}

/** `.dsmith/`를 만들고 decisions.json을 임시 파일 + rename으로 원자적으로 쓴 뒤 쓴 경로를 반환한다(읽는 쪽이 반쯤 쓴 파일을 보지 않는다). */
export async function writeDecisions(root: string, file: DecisionsFile): Promise<string> {
  const target = decisionsPath(root);
  await atomicWrite(target, `${JSON.stringify(file, null, 2)}\n`);
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
