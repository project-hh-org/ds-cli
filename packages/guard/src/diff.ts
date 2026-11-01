import { runGit } from "@dsmith-dev/core";

export interface ChangedFiles {
  base: string;
  mergeBase: string;
  /** root 상대 POSIX, 정렬 */
  files: string[];
}

const GIT_TIMEOUT_MS = 30_000;
const FETCH_HINT = "--base 브랜치를 fetch했는지 확인(actions/checkout fetch-depth: 0)";

function failure(stderr: string, fallback: string): Error {
  const first = stderr.split("\n").find((l) => l.trim() !== "")?.trim() ?? fallback;
  return new Error(`${first} — ${FETCH_HINT}`);
}

/**
 * git merge-base <base> HEAD → git diff --name-only --diff-filter=ACMR <base>...HEAD.
 * 실패하면 Error(stderr 첫 줄 + "--base 브랜치를 fetch했는지 확인(actions/checkout fetch-depth: 0)")
 */
export async function changedFiles(root: string, base: string): Promise<ChangedFiles> {
  if (base === "" || base.startsWith("-")) throw new Error(`--base 값이 올바르지 않습니다: ${JSON.stringify(base)}`);
  const mb = await runGit(root, ["merge-base", base, "HEAD"], { timeoutMs: GIT_TIMEOUT_MS });
  const mergeBase = mb.stdout.trim();
  if (!mb.ok || mergeBase === "") throw failure(mb.stderr, mb.error?.message ?? `git merge-base ${base} HEAD 실패`);
  const diff = await runGit(root, ["diff", "--name-only", "-z", "--diff-filter=ACMR", `${base}...HEAD`], { timeoutMs: GIT_TIMEOUT_MS });
  if (!diff.ok) throw failure(diff.stderr, diff.error?.message ?? `git diff ${base}...HEAD 실패`);
  const files = diff.stdout.split("\0").filter((f) => f !== "").sort();
  return { base, mergeBase, files };
}

/** git show <mergeBase>:<file>. 없으면(새 파일) null */
export async function fileAtBase(root: string, mergeBase: string, file: string): Promise<string | null> {
  const res = await runGit(root, ["show", `${mergeBase}:${file}`], { timeoutMs: GIT_TIMEOUT_MS });
  return res.ok ? res.stdout : null;
}
