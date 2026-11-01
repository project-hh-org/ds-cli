import { constants } from "node:fs";
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

/**
 * `YYYYMMDD-HHMMSS`(로컬 시각). 같은 id의 기록이 이미 있으면 `-2`, `-3`…
 * 빈 파일을 `wx`(배타 생성)로 만들어 id를 예약하므로 동시에 부르는 호출끼리 같은 id를 받지 못한다.
 * 예약 파일은 곧 `writeMigration`이 같은 id로 덮어쓴다(그 사이 `readMigration`은 빈 파일을 "기록 없음"으로 본다).
 */
export async function newMigrationId(root: string, now: Date): Promise<string> {
  const base = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  await fs.mkdir(dirOf(root), { recursive: true });
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    try {
      const handle = await fs.open(path.join(dirOf(root), `${id}.json`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      await handle.close();
      return id;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
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
  if (text === "") return null; // newMigrationId가 예약만 해 둔 파일
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${MIGRATIONS_DIR}/${id}.json을 JSON으로 읽을 수 없음: ${(err as Error).message}`);
  }
  const version = (parsed as { version?: unknown } | null)?.version;
  if (version !== 1) {
    throw new Error(`${MIGRATIONS_DIR}/${id}.json의 version이 ${String(version)}이라 읽을 수 없음 (이 dsmith는 1만 읽는다 — dsmith를 올리세요)`);
  }
  return parsed as MigrationRecord;
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
      out.push({ id, status: rec.status, summary: rec.summary, ...(rec.branch === undefined || rec.branch === null ? {} : { branch: rec.branch.name }) });
    } catch {
      // 깨진 기록은 목록에서 뺀다
    }
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
