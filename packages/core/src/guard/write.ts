import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/safe-write.js";
import { GUARD_FILE, type GuardSnapshot } from "./snapshot.js";

const KEY_ORDER: (keyof GuardSnapshot)[] = [
  "version", "dsmith", "extractors", "tokens", "tokenSource", "tokenFiles", "ds", "preferred", "preset", "exclude", "moduleContext", "policy",
];

/** 키 순서를 고정해 2칸 + "\n"으로 쓴다. 타임스탬프·절대 경로 없음 */
export async function writeGuardSnapshot(root: string, s: GuardSnapshot): Promise<string> {
  const ordered: Record<string, unknown> = {};
  for (const k of KEY_ORDER) ordered[k] = s[k];
  const file = path.resolve(root, GUARD_FILE);
  await atomicWrite(file, `${JSON.stringify(ordered, null, 2)}\n`);
  return file;
}

/** 스냅샷을 만든 뒤 내용이 바뀌었거나 없어진 토큰 파일(root 상대). 비어 있으면 최신 */
export async function staleGuardTokenFiles(root: string, s: GuardSnapshot): Promise<string[]> {
  const stale: string[] = [];
  for (const rec of s.tokenFiles) {
    let sha: string | null = null;
    try {
      sha = createHash("sha256").update(await fs.readFile(path.resolve(root, rec.file))).digest("hex");
    } catch {
      sha = null;
    }
    if (sha !== rec.sha256) stale.push(rec.file);
  }
  return stale;
}
