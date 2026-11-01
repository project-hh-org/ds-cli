import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_DIR = "design-system";

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isFile();
  } catch {
    return false;
  }
}

/**
 * init 산출 디렉터리: `.dsmith/init.json` 엔트리 키 중 "<dir>/tokens.json"의 dir
 * → 없으면 "design-system/tokens.json"이 있으면 "design-system" → null.
 * init 패키지를 import하지 않고 매니페스트 키 규칙(레포 루트 상대 경로)만 읽는다.
 */
export async function findInitDir(root: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(root, ".dsmith", "init.json"), "utf-8")) as {
      entries?: Record<string, unknown>;
    };
    const keys = Object.keys(parsed.entries ?? {}).sort();
    for (const key of keys) {
      if (key.includes("#")) continue;
      if (key === "tokens.json") return ".";
      if (key.endsWith("/tokens.json")) return key.slice(0, -"/tokens.json".length);
    }
  } catch {
    // 매니페스트 없음·깨짐 → 기본 위치 확인
  }
  return (await isFile(path.join(root, DEFAULT_DIR, "tokens.json"))) ? DEFAULT_DIR : null;
}
