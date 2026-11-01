import { existsSync } from "node:fs";
import path from "node:path";
import { runGit, type GitResult } from "@dsmith-dev/core";

/** git 호출은 core `runGit` 하나로만 한다(timeout 필수). 작성자는 레포 설정이 정하고 dsmith는 `--author`를 넘기지 않는다 */
export type BranchCheck =
  /** include = `withTokens`일 때 같은 커밋에 넣을 토큰 파일(untracked이거나 수정된 것). 없으면 생략 */
  { ok: true; base: string; baseSha: string; include?: string[] } | { ok: false; reason: string };

export interface BranchCheckOptions {
  /** 계획이 쓴 토큰 파일·연결된 프리셋/테마 파일(root 상대). `.dsmith/` 아래는 늘 제외 */
  tokenFiles?: string[];
  /** true면 untracked·수정된 토큰 파일을 오류로 막지 않고 `include`로 돌려준다(커밋에 함께 넣음) */
  withTokens?: boolean;
}

const COMMIT_TIMEOUT_MS = 30_000;
const MIN_GIT = [2, 23] as const;

/** 훅·`rebase -x` 안에서 돌면 물려받는, 다른 레포를 가리킬 수 있는 환경 변수. 작업은 항상 root(cwd)의 레포에서 한다 */
const AMBIENT_GIT_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] as const;

const git = (root: string, args: string[], opts: { timeoutMs?: number; input?: string } = {}): Promise<GitResult> =>
  runGit(root, args, { ...opts, unsetEnv: AMBIENT_GIT_ENV });

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

/** `git version 2.39.2`·`git version 2.37.1 (Apple Git-137.1)` → [2, 39]. 읽지 못하면 null */
export function parseGitVersion(text: string): [number, number] | null {
  const m = /git version (\d+)\.(\d+)/.exec(text);
  return m === null ? null : [Number(m[1]), Number(m[2])];
}

/**
 * 브랜치를 만들어도 되는지 파일을 쓰기 전에 확인한다:
 * git 2.23 이상(`git switch`), root가 git 작업 트리(커밋 있음), `git var GIT_AUTHOR_IDENT` 성공, 유효한 이름, refs/heads/<name> 없음,
 * 대상 파일이 `.gitignore`에 걸리지 않음, `git status --porcelain -- <files>` 비어 있음(대상 파일이 깨끗). base = 현재 브랜치 이름(분리 HEAD면 sha).
 */
export async function checkBranch(root: string, name: string, files: string[], opts: BranchCheckOptions = {}): Promise<BranchCheck> {
  const version = await git(root, ["--version"]);
  if (version.error?.kind === "not-found") return { ok: false, reason: "git을 찾을 수 없음" };
  const parsed = version.ok ? parseGitVersion(version.stdout) : null;
  if (parsed !== null && (parsed[0] < MIN_GIT[0] || (parsed[0] === MIN_GIT[0] && parsed[1] < MIN_GIT[1]))) {
    return { ok: false, reason: `git ${MIN_GIT[0]}.${MIN_GIT[1]} 이상 필요(\`git switch\` 사용) — 현재 ${parsed[0]}.${parsed[1]}` };
  }

  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.error?.kind === "not-found") return { ok: false, reason: "git을 찾을 수 없음" };
  if (!inside.ok || inside.stdout.trim() !== "true") return { ok: false, reason: "git 작업 트리가 아님 — --branch는 git 레포에서만 쓸 수 있음" };

  const head = await git(root, ["rev-parse", "HEAD"]);
  if (!head.ok) return { ok: false, reason: "커밋이 하나도 없는 레포 — 첫 커밋을 만든 뒤 다시 실행하세요" };
  const baseSha = head.stdout.trim();

  const ident = await git(root, ["var", "GIT_AUTHOR_IDENT"]);
  if (!ident.ok) {
    return { ok: false, reason: `git 작성자 정보가 없음(user.name·user.email을 설정하세요): ${firstLine(ident.stderr)}` };
  }

  const format = await git(root, ["check-ref-format", "--branch", name]);
  if (!format.ok) return { ok: false, reason: `브랜치 이름이 올바르지 않음: ${name}` };
  const exists = await git(root, ["rev-parse", "--verify", "-q", `refs/heads/${name}`]);
  if (exists.ok) return { ok: false, reason: `브랜치가 이미 있음: ${name}` };

  // 토큰·프리셋 파일: 치환된 var()·프리셋이 가리키는 파일이 브랜치에도 있어야 한다. untracked·수정이면 막거나(기본) 커밋에 함께 넣는다(--with-tokens)
  const tokenFiles = [...new Set(opts.tokenFiles ?? [])].filter((f) => !f.startsWith(".dsmith/") && !files.includes(f)).sort();
  let include: string[] = [];
  if (tokenFiles.length > 0) {
    const tracked = await git(root, ["ls-files", "-z", "--", ...tokenFiles], { timeoutMs: 30_000 });
    if (!tracked.ok) return { ok: false, reason: `git ls-files 실패: ${firstLine(tracked.stderr)}` };
    const trackedSet = new Set(tracked.stdout.split("\0").filter((l) => l !== ""));
    const status = await git(root, ["status", "--porcelain", "--", ...tokenFiles], { timeoutMs: 30_000 });
    if (!status.ok) return { ok: false, reason: `git status 실패: ${firstLine(status.stderr)}` };
    const changed = new Set(status.stdout.split("\n").filter((l) => l.trim() !== "").map((l) => l.slice(3)));
    // 디렉터리 단위 `??`(untracked 폴더)는 안의 파일로 풀어 주지 않으니, 추적되지 않는 파일은 따로 센다
    const missing = tokenFiles.filter((f) => !trackedSet.has(f) && existsSync(path.join(root, f)));
    include = tokenFiles.filter((f) => missing.includes(f) || changed.has(f));
    if (include.length > 0 && opts.withTokens !== true) {
      const shown = include.slice(0, 5).join(", ");
      return {
        ok: false,
        reason: `토큰 파일이 브랜치에 없음(커밋되지 않았거나 수정됨): ${shown}${include.length > 5 ? ` 외 ${include.length - 5}개` : ""} — 치환된 var()·프리셋이 가리킬 파일이 PR에 빠집니다. 먼저 커밋하거나 --with-tokens로 함께 커밋`,
      };
    }
  }

  const checked = opts.withTokens === true ? [...files, ...include] : files;
  if (checked.length > 0) {
    // 무시된 파일은 `git status`에 나오지 않지만 `git add`가 거부하니, 쓰기 전에 걸러낸다(추적 중인 파일은 무시 규칙에 걸려도 괜찮다)
    const ignored = await git(root, ["check-ignore", "--stdin"], { input: `${checked.join("\n")}\n`, timeoutMs: 30_000 });
    if (ignored.code !== 0 && ignored.code !== 1) return { ok: false, reason: `git check-ignore 실패: ${firstLine(ignored.stderr) || ignored.error?.message || ""}` };
    const hits = ignored.stdout.split("\n").filter((l) => l.trim() !== "");
    if (hits.length > 0) {
      return { ok: false, reason: `치환 대상 파일이 .gitignore에 걸려 커밋할 수 없음: ${hits.slice(0, 5).join(", ")}${hits.length > 5 ? ` 외 ${hits.length - 5}개` : ""}` };
    }

    if (files.length > 0) {
      const status = await git(root, ["status", "--porcelain", "--", ...files], { timeoutMs: 30_000 });
      if (!status.ok) return { ok: false, reason: `git status 실패: ${firstLine(status.stderr)}` };
      const dirty = status.stdout.split("\n").filter((l) => l.trim() !== "");
      if (dirty.length > 0) {
        const shown = dirty.slice(0, 5).map((l) => l.slice(3));
        return { ok: false, reason: `치환 대상 파일에 커밋하지 않은 변경이 있음: ${shown.join(", ")}${dirty.length > 5 ? ` 외 ${dirty.length - 5}개` : ""}` };
      }
    }
  }

  const branch = await git(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const base = branch.ok && branch.stdout.trim() !== "" ? branch.stdout.trim() : baseSha;
  return { ok: true, base, baseSha, ...(opts.withTokens === true && include.length > 0 ? { include } : {}) };
}

export async function createBranch(root: string, name: string): Promise<void> {
  const r = await git(root, ["switch", "-c", name]);
  if (!r.ok) throw new Error(`브랜치를 만들지 못함(${name}): ${firstLine(r.stderr) || r.error?.message || "git switch 실패"}`);
}

/** 대상 파일만 add → 그 경로만 커밋(인덱스에 다른 스테이징이 있어도 섞이지 않는다) → 새 커밋의 sha */
export async function commitFiles(root: string, files: string[], message: string): Promise<string> {
  const add = await git(root, ["add", "--", ...files], { timeoutMs: COMMIT_TIMEOUT_MS });
  if (!add.ok) throw new Error(`git add 실패: ${firstLine(add.stderr) || add.error?.message || ""}`);
  const commit = await git(root, ["commit", "-m", message, "--", ...files], { timeoutMs: COMMIT_TIMEOUT_MS });
  if (!commit.ok) {
    throw new Error(`git commit 실패: ${firstLine(commit.stderr) || firstLine(commit.stdout) || commit.error?.message || ""}`);
  }
  const sha = await git(root, ["rev-parse", "HEAD"]);
  if (!sha.ok) throw new Error("커밋 sha를 읽지 못함");
  return sha.stdout.trim();
}

/** 적용 0건이면 만든 브랜치를 없앤다: base로 돌아가 브랜치 삭제 */
export async function abandonBranch(root: string, base: string, name: string): Promise<void> {
  const back = await git(root, /^[0-9a-f]{40}$/.test(base) ? ["switch", "--detach", base] : ["switch", base]);
  if (!back.ok) throw new Error(`원래 브랜치로 돌아가지 못함(${base}): ${firstLine(back.stderr)}`);
  const del = await git(root, ["branch", "-D", name]);
  if (!del.ok) throw new Error(`브랜치를 지우지 못함(${name}): ${firstLine(del.stderr)}`);
}

export function commitMessage(tokens: number, components: number): string {
  return components > 0
    ? `chore(ds): 하드코딩 ${tokens}건을 토큰으로, 컴포넌트 import ${components}건을 DS로 치환 (dsmith migrate)`
    : `chore(ds): 하드코딩 ${tokens}건을 토큰으로 치환 (dsmith migrate)`;
}
