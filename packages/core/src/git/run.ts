import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BUFFER = 8 * 1024 * 1024;

export interface GitError {
  /** not-found: git 실행 파일 없음(ENOENT) · timeout: 시간 초과로 종료됨 · spawn: 그 밖의 실행 실패(없는 cwd, 버퍼 초과 등) — ENOENT는 cwd가 있을 때만 not-found */
  kind: "not-found" | "timeout" | "spawn";
  message: string;
}

export interface GitResult {
  ok: boolean;
  /** 프로세스 종료 코드. 실행하지 못했거나 시간 초과로 죽었으면 null */
  code: number | null;
  stdout: string;
  stderr: string;
  /** git이 돌지 못했거나 시간 초과일 때만(비 0 종료는 code·stderr로 본다) */
  error?: GitError;
}

/**
 * core의 유일한 프로세스 실행. `git <args>`를 `root`에서 timeout(기본 5000ms)과 함께 돌린다.
 * git이 없음·없는 cwd·타임아웃·비 0 종료는 모두 `ok: false`로 돌려주고 예외를 던지지 않는다.
 * 대화형으로 멈추지 않게 stdin은 `input`을 넘기고 닫거나(없으면 바로 닫음), `GIT_TERMINAL_PROMPT=0`·`GIT_EDITOR=true`로 프롬프트·편집기를 막고,
 * 메시지는 `LC_ALL=C`로 고정한다. 기본 5초는 조회용이다 — `commit`처럼 훅이 도는 명령은 호출자가 더 긴 `timeoutMs`를 넘겨야 한다.
 */
export function runGit(
  root: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string; /** 자식 프로세스 환경에서 지울 변수(예: GIT_DIR) */ unsetEnv?: readonly string[] } = {},
): Promise<GitResult> {
  return new Promise((resolve) => {
    const fail = (error: GitError): void => resolve({ ok: false, code: null, stdout: "", stderr: "", error });
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", LC_ALL: "C" };
      for (const name of opts.unsetEnv ?? []) delete env[name];
      const child = execFile(
        "git",
        args,
        {
          cwd: root,
          timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          encoding: "utf-8",
          env,
        },
        (err, stdout, stderr) => {
          if (err === null) {
            resolve({ ok: true, code: 0, stdout, stderr });
            return;
          }
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
          if (typeof e.code === "number") {
            resolve({ ok: false, code: e.code, stdout: stdout ?? "", stderr: stderr ?? "" });
            return;
          }
          const kind: GitError["kind"] = e.code === "ENOENT" && existsSync(root) ? "not-found" : e.killed === true ? "timeout" : "spawn";
          resolve({ ok: false, code: null, stdout: stdout ?? "", stderr: stderr ?? "", error: { kind, message: e.message } });
        },
      );
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.input);
    } catch (err) {
      fail({ kind: "spawn", message: (err as Error).message });
    }
  });
}
