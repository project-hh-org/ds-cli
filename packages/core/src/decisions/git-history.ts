import { execFile } from "node:child_process";
import type { GitHistory } from "./model.js";

const DEFAULT_TIMEOUT_MS = 5000;
const SHA_LENGTH = 7;
const MAX_BUFFER = 8 * 1024 * 1024;

function run(root: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile("git", args, { cwd: root, timeout: timeoutMs, maxBuffer: MAX_BUFFER, encoding: "utf-8" }, (err, stdout) => {
        resolve(err ? null : stdout);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * `git log --follow`로 파일의 첫·마지막 커밋과 고유 작성자 수를 읽는다.
 * git이 없거나(ENOENT)·레포가 아니거나·타임아웃이거나·이력이 비면 null — 예외를 던지지 않는다.
 */
export async function readGitHistory(
  root: string,
  file: string,
  opts: { timeoutMs?: number } = {},
): Promise<GitHistory | null> {
  const stdout = await run(
    root,
    ["log", "--follow", "--format=%H%x09%aI%x09%ae", "--", file],
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (stdout === null) return null;
  const lines = stdout.split("\n").filter((l) => l !== "");
  const first = lines[lines.length - 1];
  const last = lines[0];
  if (first === undefined || last === undefined) return null;
  const parse = (line: string): { sha: string; date: string; email: string } => {
    const [sha = "", date = "", email = ""] = line.split("\t");
    return { sha: sha.slice(0, SHA_LENGTH), date, email };
  };
  const emails = new Set(lines.map((l) => parse(l).email));
  const f = parse(first);
  const l = parse(last);
  return {
    firstCommit: { sha: f.sha, date: f.date },
    lastCommit: { sha: l.sha, date: l.date },
    authorsCount: emails.size,
  };
}
