import path from "node:path";

const DEFAULT_OUT_DIR = "design-system";
const FORBIDDEN_SEGMENTS = new Set([".dsmith", "node_modules", ".git"]);

/**
 * `--out` 검증: 상대 경로, root 안, `.dsmith`·`node_modules` 아님, `..` 없음 → POSIX 정규화.
 * 기본 "design-system". 위반하면 Error.
 */
export function normalizeOutDir(root: string, out: string | undefined): string {
  const raw = out ?? DEFAULT_OUT_DIR;
  const fail = (why: string): never => {
    throw new Error(`--out은 레포 안의 상대 경로여야 합니다 (${why}): ${raw}`);
  };
  if (raw.trim() === "") return fail("비어 있음");
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw)) return fail("절대 경로");
  const posix = raw.replace(/\\/g, "/");
  if (posix.split("/").includes("..")) return fail("`..` 포함");
  const normalized = path.posix.normalize(posix).replace(/\/+$/, "");
  if (normalized === "" || normalized === ".") return fail("레포 루트");
  const segment = normalized.split("/").find((s) => FORBIDDEN_SEGMENTS.has(s));
  if (segment !== undefined) return fail(`${segment}는 쓸 수 없음`);
  const rel = path.relative(path.resolve(root), path.resolve(root, normalized));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return fail("root 밖");
  return normalized;
}
