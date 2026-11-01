import fs from "node:fs/promises";
import path from "node:path";
import {
  applyPatches,
  invertRecordedPatches,
  readMigration,
  sha256Text,
  writeMigration,
  writePatchedFile,
} from "@dsmith-dev/core";

export interface RevertResult {
  id: string;
  files: { file: string; status: "reverted" | "already-original" | "skipped-modified" | "missing"; reason?: string }[];
}

/**
 * 기록의 파일을 현재 내용의 해시로 판정해 되돌린다(applied·pending·이미 reverted인 파일).
 * 현재 sha === after → 기록된 역패치 적용 → 결과 sha === before 확인 → 해시 비교 쓰기(reverted).
 * 현재 sha === before → already-original. 그 밖(적용 뒤 사용자가 고침) → skipped-modified, 건드리지 않음.
 * 모든 파일이 reverted·already-original이면 기록 status를 "reverted"로.
 */
export async function revertMigration(root: string, id: string): Promise<RevertResult> {
  const record = await readMigration(root, id);
  if (record === null) throw new Error(`마이그레이션 기록이 없음: ${id}`);

  const files: RevertResult["files"] = [];
  for (const entry of record.files) {
    if (entry.status === "rolled-back" || entry.status === "skipped-modified") continue;
    let current: string;
    try {
      current = await fs.readFile(path.resolve(root, entry.file), "utf-8");
    } catch {
      files.push({ file: entry.file, status: "missing", reason: "파일이 없음" });
      continue;
    }
    const sha = sha256Text(current);
    if (sha === entry.before) {
      files.push({ file: entry.file, status: "already-original" });
      entry.status = "reverted";
      continue;
    }
    if (sha !== entry.after) {
      files.push({ file: entry.file, status: "skipped-modified", reason: "적용 뒤 수정됨" });
      continue;
    }
    let restored: string;
    try {
      restored = applyPatches(current, invertRecordedPatches(entry.patches));
    } catch (err) {
      files.push({ file: entry.file, status: "skipped-modified", reason: `역패치 적용 실패: ${(err as Error).message}` });
      continue;
    }
    if (sha256Text(restored) !== entry.before) {
      files.push({ file: entry.file, status: "skipped-modified", reason: "역패치 결과가 원본과 다름" });
      continue;
    }
    const written = await writePatchedFile(root, entry.file, entry.after, restored);
    if (!written.written) {
      files.push({ file: entry.file, status: "skipped-modified", reason: written.reason ?? "쓰지 못함" });
      continue;
    }
    entry.status = "reverted";
    files.push({ file: entry.file, status: "reverted" });
  }

  if (files.every((f) => f.status === "reverted" || f.status === "already-original")) record.status = "reverted";
  await writeMigration(root, record);
  return { id, files };
}
