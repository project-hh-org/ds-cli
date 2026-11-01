import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../fs/safe-write.js";

/** hex sha256. 원문 그대로(BOM·CRLF 정규화 없음 — 바이트 일치가 목적) */
export const sha256Text = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const inside = (root: string, abs: string): boolean => {
  const rel = path.relative(root, abs);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * 사용자 소스 파일 쓰기. 현재 파일의 sha256이 `expectedSha`와 같을 때만 `atomicWrite`한다.
 * 다르면 `{ written: false, reason: "계획 뒤 파일이 바뀜" }`. 심볼릭 링크(파일·상위 디렉터리)이거나 root 밖이면 쓰지 않는다.
 */
export async function writePatchedFile(
  root: string,
  file: string,
  expectedSha: string,
  content: string,
): Promise<{ written: boolean; reason?: string }> {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, file);
  if (!inside(rootAbs, abs)) return { written: false, reason: "root 밖 경로" };
  try {
    if ((await fs.lstat(abs)).isSymbolicLink()) return { written: false, reason: "심볼릭 링크" };
    const realRoot = await fs.realpath(rootAbs);
    const realDir = await fs.realpath(path.dirname(abs));
    if (realDir !== realRoot && !inside(realRoot, realDir)) return { written: false, reason: "root 밖 경로" };
    const current = createHash("sha256").update(await fs.readFile(abs)).digest("hex");
    if (current !== expectedSha) return { written: false, reason: "계획 뒤 파일이 바뀜" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { written: false, reason: "파일이 없음" };
    return { written: false, reason: `파일을 확인할 수 없음: ${(err as Error).message}` };
  }
  await atomicWrite(abs, content);
  return { written: true };
}
