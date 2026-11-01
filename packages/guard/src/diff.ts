import { runGit } from "@dsmith-dev/core";

export interface ChangedFiles {
  base: string;
  mergeBase: string;
  /** root 상대 POSIX, 정렬 */
  files: string[];
  /** 이름이 바뀐 파일: 새 경로 → merge-base 시점의 옛 경로(둘 다 root 상대) */
  baseOf: Map<string, string>;
}

const GIT_TIMEOUT_MS = 30_000;
const FETCH_HINT = "--base 브랜치를 fetch했는지 확인(actions/checkout fetch-depth: 0)";

function failure(stderr: string, fallback: string): Error {
  const first = stderr.split("\n").find((l) => l.trim() !== "")?.trim() ?? fallback;
  return new Error(`${first} — ${FETCH_HINT}`);
}

/**
 * git merge-base <base> HEAD → git diff --relative --name-status -z -M --diff-filter=ACMR <base>...HEAD (root에서 실행).
 * 경로는 root 기준이며 root 밖 변경은 빠진다(모노레포 하위 디렉터리). 이름만 바뀐 파일은 baseOf로 옛 경로를 알려 준다.
 * 실패하면 Error(stderr 첫 줄 + "--base 브랜치를 fetch했는지 확인(actions/checkout fetch-depth: 0)")
 */
export async function changedFiles(root: string, base: string): Promise<ChangedFiles> {
  if (base === "" || base.startsWith("-")) throw new Error(`--base 값이 올바르지 않습니다: ${JSON.stringify(base)}`);
  const mb = await runGit(root, ["merge-base", base, "HEAD"], { timeoutMs: GIT_TIMEOUT_MS });
  const mergeBase = mb.stdout.trim();
  if (!mb.ok || mergeBase === "") throw failure(mb.stderr, mb.error?.message ?? `git merge-base ${base} HEAD 실패`);
  const diff = await runGit(root, ["diff", "--relative", "--name-status", "-z", "-M", "--diff-filter=ACMR", `${base}...HEAD`], {
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (!diff.ok) throw failure(diff.stderr, diff.error?.message ?? `git diff ${base}...HEAD 실패`);

  const tokens = diff.stdout.split("\0");
  const found = new Set<string>();
  const baseOf = new Map<string, string>();
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i] ?? "";
    if (status === "") {
      i += 1;
      continue;
    }
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = tokens[i + 1] ?? "";
      const to = tokens[i + 2] ?? "";
      i += 3;
      if (to === "") continue;
      found.add(to);
      if (status.startsWith("R") && from !== "") baseOf.set(to, from);
    } else {
      const file = tokens[i + 1] ?? "";
      i += 2;
      if (file !== "") found.add(file);
    }
  }
  return { base, mergeBase, files: [...found].sort(), baseOf };
}

const ABSENT = /does not exist in|exists on disk, but not in/;

/**
 * git show <mergeBase>:./<file> (root에서 실행 — 하위 디렉터리 root에서도 root 상대 경로가 맞는다).
 * merge-base에 그 경로가 없으면(새 파일) null. 그 밖의 git 오류(시간 초과·버퍼 초과 등)는 stderr와 함께 던진다.
 */
export async function fileAtBase(root: string, mergeBase: string, file: string): Promise<string | null> {
  const res = await runGit(root, ["show", `${mergeBase}:./${file}`], { timeoutMs: GIT_TIMEOUT_MS });
  if (res.ok) return res.stdout;
  if (res.code !== null && ABSENT.test(res.stderr)) return null;
  const detail = res.stderr.split("\n").find((l) => l.trim() !== "")?.trim() ?? res.error?.message ?? `종료 코드 ${res.code ?? "?"}`;
  throw new Error(`git show ${mergeBase.slice(0, 7)}:./${file} 실패: ${detail}`);
}
