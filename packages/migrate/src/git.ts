import { runGit } from "@dsmith-dev/core";

/** git 호출은 core `runGit` 하나로만 한다(timeout 필수). 작성자는 레포 설정이 정하고 dsmith는 `--author`를 넘기지 않는다 */
export type BranchCheck = { ok: true; base: string; baseSha: string } | { ok: false; reason: string };

const COMMIT_TIMEOUT_MS = 30_000;

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

/**
 * 브랜치를 만들어도 되는지 파일을 쓰기 전에 확인한다:
 * root가 git 작업 트리(커밋 있음), `git var GIT_AUTHOR_IDENT` 성공, 유효한 이름, refs/heads/<name> 없음,
 * `git status --porcelain -- <files>` 비어 있음(대상 파일이 깨끗). base = 현재 브랜치 이름(분리 HEAD면 sha).
 */
export async function checkBranch(root: string, name: string, files: string[]): Promise<BranchCheck> {
  const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.error?.kind === "not-found") return { ok: false, reason: "git을 찾을 수 없음" };
  if (!inside.ok || inside.stdout.trim() !== "true") return { ok: false, reason: "git 작업 트리가 아님 — --branch는 git 레포에서만 쓸 수 있음" };

  const head = await runGit(root, ["rev-parse", "HEAD"]);
  if (!head.ok) return { ok: false, reason: "커밋이 하나도 없는 레포 — 첫 커밋을 만든 뒤 다시 실행하세요" };
  const baseSha = head.stdout.trim();

  const ident = await runGit(root, ["var", "GIT_AUTHOR_IDENT"]);
  if (!ident.ok) {
    return { ok: false, reason: `git 작성자 정보가 없음(user.name·user.email을 설정하세요): ${firstLine(ident.stderr)}` };
  }

  const format = await runGit(root, ["check-ref-format", "--branch", name]);
  if (!format.ok) return { ok: false, reason: `브랜치 이름이 올바르지 않음: ${name}` };
  const exists = await runGit(root, ["rev-parse", "--verify", "-q", `refs/heads/${name}`]);
  if (exists.ok) return { ok: false, reason: `브랜치가 이미 있음: ${name}` };

  if (files.length > 0) {
    const status = await runGit(root, ["status", "--porcelain", "--", ...files], { timeoutMs: 30_000 });
    if (!status.ok) return { ok: false, reason: `git status 실패: ${firstLine(status.stderr)}` };
    const dirty = status.stdout.split("\n").filter((l) => l.trim() !== "");
    if (dirty.length > 0) {
      const shown = dirty.slice(0, 5).map((l) => l.slice(3));
      return { ok: false, reason: `치환 대상 파일에 커밋하지 않은 변경이 있음: ${shown.join(", ")}${dirty.length > 5 ? ` 외 ${dirty.length - 5}개` : ""}` };
    }
  }

  const branch = await runGit(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return { ok: true, base: branch.ok && branch.stdout.trim() !== "" ? branch.stdout.trim() : baseSha, baseSha };
}

export async function createBranch(root: string, name: string): Promise<void> {
  const r = await runGit(root, ["switch", "-c", name]);
  if (!r.ok) throw new Error(`브랜치를 만들지 못함(${name}): ${firstLine(r.stderr) || r.error?.message || "git switch 실패"}`);
}

/** 대상 파일만 add → 그 경로만 커밋(인덱스에 다른 스테이징이 있어도 섞이지 않는다) → 새 커밋의 sha */
export async function commitFiles(root: string, files: string[], message: string): Promise<string> {
  const add = await runGit(root, ["add", "--", ...files], { timeoutMs: COMMIT_TIMEOUT_MS });
  if (!add.ok) throw new Error(`git add 실패: ${firstLine(add.stderr) || add.error?.message || ""}`);
  const commit = await runGit(root, ["commit", "-m", message, "--", ...files], { timeoutMs: COMMIT_TIMEOUT_MS });
  if (!commit.ok) {
    throw new Error(`git commit 실패: ${firstLine(commit.stderr) || firstLine(commit.stdout) || commit.error?.message || ""}`);
  }
  const sha = await runGit(root, ["rev-parse", "HEAD"]);
  if (!sha.ok) throw new Error("커밋 sha를 읽지 못함");
  return sha.stdout.trim();
}

/** 적용 0건이면 만든 브랜치를 없앤다: base로 돌아가 브랜치 삭제 */
export async function abandonBranch(root: string, base: string, name: string): Promise<void> {
  const back = await runGit(root, /^[0-9a-f]{40}$/.test(base) ? ["switch", "--detach", base] : ["switch", base]);
  if (!back.ok) throw new Error(`원래 브랜치로 돌아가지 못함(${base}): ${firstLine(back.stderr)}`);
  const del = await runGit(root, ["branch", "-D", name]);
  if (!del.ok) throw new Error(`브랜치를 지우지 못함(${name}): ${firstLine(del.stderr)}`);
}

export function commitMessage(tokens: number, components: number): string {
  return components > 0
    ? `chore(ds): 하드코딩 ${tokens}건을 토큰으로, 컴포넌트 import ${components}건을 DS로 치환 (dsmith migrate)`
    : `chore(ds): 하드코딩 ${tokens}건을 토큰으로 치환 (dsmith migrate)`;
}
