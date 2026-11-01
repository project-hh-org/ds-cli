import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/safe-write.js";
import type { MigrationRecord } from "./model.js";

export const MIGRATIONS_DIR = ".dsmith/migrations";

const dirOf = (root: string): string => path.join(root, ...MIGRATIONS_DIR.split("/"));

function assertId(id: string): void {
  if (id === "" || id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error(`마이그레이션 id가 올바르지 않음: ${id}`);
  }
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYYMMDD-HHMMSS`(로컬 시각). 같은 id의 기록이 이미 있으면 `-2`, `-3`… */
export async function newMigrationId(root: string, now: Date): Promise<string> {
  const base = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let existing: Set<string>;
  try {
    existing = new Set((await fs.readdir(dirOf(root))).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)));
  } catch {
    existing = new Set();
  }
  if (!existing.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!existing.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/** `.dsmith/migrations/<id>.json`을 atomicWrite로 쓰고 root 상대 경로를 반환한다. */
export async function writeMigration(root: string, rec: MigrationRecord): Promise<string> {
  assertId(rec.id);
  await atomicWrite(path.join(dirOf(root), `${rec.id}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  return `${MIGRATIONS_DIR}/${rec.id}.json`;
}

/** 없으면 null, 깨진 JSON은 Error. id에 `/`·`\`·`..`가 있으면 Error. */
export async function readMigration(root: string, id: string): Promise<MigrationRecord | null> {
  assertId(id);
  let text: string;
  try {
    text = await fs.readFile(path.join(dirOf(root), `${id}.json`), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(text) as MigrationRecord;
  } catch (err) {
    throw new Error(`${MIGRATIONS_DIR}/${id}.json을 JSON으로 읽을 수 없음: ${(err as Error).message}`);
  }
}

/** id 내림차순(최신 먼저). 읽을 수 없는 파일은 건너뛴다. */
export async function listMigrations(
  root: string,
): Promise<{ id: string; status: MigrationRecord["status"]; summary: MigrationRecord["summary"]; branch?: string }[]> {
  let names: string[];
  try {
    names = (await fs.readdir(dirOf(root))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: { id: string; status: MigrationRecord["status"]; summary: MigrationRecord["summary"]; branch?: string }[] = [];
  for (const name of names) {
    const id = name.slice(0, -".json".length);
    try {
      const rec = await readMigration(root, id);
      if (rec === null) continue;
      out.push({ id, status: rec.status, summary: rec.summary, ...(rec.branch === undefined ? {} : { branch: rec.branch.name }) });
    } catch {
      // 깨진 기록은 목록에서 뺀다
    }
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
