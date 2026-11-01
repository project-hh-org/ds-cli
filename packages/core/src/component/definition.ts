import fs from "node:fs/promises";
import path from "node:path";

export const DEFINITION_EXTENSIONS: readonly string[] = [".tsx", ".ts", ".jsx", ".js"];

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isFile();
  } catch {
    return false;
  }
}

/**
 * module(root 상대 경로, 확장자 없음)을 실제 파일로 푼다: `${m}${ext}` → `${m}/index${ext}`.
 * 없으면(패키지·root 밖 경로 등) null. root 상대 POSIX 경로를 반환한다.
 */
export async function resolveDefinitionFile(root: string, module: string): Promise<string | null> {
  if (module === "" || path.isAbsolute(module)) return null;
  const absRoot = path.resolve(root);
  const base = path.resolve(absRoot, module);
  const rel = path.relative(absRoot, base);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const relPosix = rel.split(path.sep).join("/");
  const candidates = [
    ...DEFINITION_EXTENSIONS.map((ext) => `${relPosix}${ext}`),
    ...DEFINITION_EXTENSIONS.map((ext) => `${relPosix}/index${ext}`),
  ];
  for (const candidate of candidates) {
    if (await isFile(path.join(absRoot, candidate))) return candidate;
  }
  return null;
}
