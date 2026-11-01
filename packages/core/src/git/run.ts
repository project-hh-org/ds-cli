import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BUFFER = 8 * 1024 * 1024;

export interface GitResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * core의 유일한 프로세스 실행. `git <args>`를 `root`에서 timeout(기본 5000ms)과 함께 돌린다.
 * git이 없음(ENOENT)·타임아웃·비 0 종료는 모두 `ok: false`로 돌려주고 예외를 던지지 않는다.
 * `input`이 있으면 표준 입력으로 넘긴다.
 */
export function runGit(
  root: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string } = {},
): Promise<GitResult> {
  return new Promise((resolve) => {
    try {
      const child = execFile(
        "git",
        args,
        { cwd: root, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: "utf-8" },
        (err, stdout, stderr) => {
          if (err === null) {
            resolve({ ok: true, code: 0, stdout, stderr });
            return;
          }
          const code = (err as NodeJS.ErrnoException & { code?: unknown }).code;
          resolve({ ok: false, code: typeof code === "number" ? code : null, stdout: stdout ?? "", stderr: stderr ?? "" });
        },
      );
      if (opts.input !== undefined) {
        child.stdin?.on("error", () => {});
        child.stdin?.end(opts.input);
      }
    } catch {
      resolve({ ok: false, code: null, stdout: "", stderr: "" });
    }
  });
}
