import fs from "node:fs";
import { createHash } from "node:crypto";
import { findGuardSnapshotSync } from "@dsmith-dev/core";

/**
 * `startDir`에서 위로 올라가며 찾은 `.dsmith/guard.json` 내용의 sha256(hex). 파일이 없거나 못 읽으면 "none". 던지지 않는다.
 * `configs.recommended`가 이 값을 `settings.dsmith.snapshotHash`에 넣어, ESLint의 `--cache` 키(설정 해시)가
 * guard.json이 바뀔 때 함께 바뀌게 한다.
 */
export function guardSnapshotHash(startDir: string = process.cwd()): string {
  try {
    const found = findGuardSnapshotSync(startDir);
    if (found === null) return "none";
    return createHash("sha256").update(fs.readFileSync(found.file)).digest("hex");
  } catch {
    return "none";
  }
}
