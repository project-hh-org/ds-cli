import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGitHistory } from "../src/decisions/git-history.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-git-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: tmp, stdio: "ignore" });
}

function commit(email: string, date: string, content: string): void {
  fs.writeFileSync(path.join(tmp, "Button.tsx"), content);
  git("add", "Button.tsx");
  execFileSync("git", ["-c", "user.name=t", "-c", `user.email=${email}`, "commit", "-m", content], {
    cwd: tmp,
    stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

describe("readGitHistory", () => {
  it("커밋 두 번(작성자 2명)이면 first≠last, authorsCount 2, sha 7자", async () => {
    git("init", "-q");
    commit("a@t", "2025-01-01T00:00:00+00:00", "one");
    commit("b@t", "2025-06-01T00:00:00+00:00", "two");
    const h = await readGitHistory(tmp, "Button.tsx");
    expect(h).not.toBeNull();
    expect(h?.authorsCount).toBe(2);
    expect(h?.firstCommit.sha).toHaveLength(7);
    expect(h?.lastCommit.sha).toHaveLength(7);
    expect(h?.firstCommit.sha).not.toBe(h?.lastCommit.sha);
    expect(h?.firstCommit.date).toBe("2025-01-01T00:00:00+00:00");
    expect(h?.lastCommit.date).toBe("2025-06-01T00:00:00+00:00");
  });

  it("같은 작성자가 두 번 커밋하면 authorsCount 1", async () => {
    git("init", "-q");
    commit("a@t", "2025-01-01T00:00:00+00:00", "one");
    commit("a@t", "2025-06-01T00:00:00+00:00", "two");
    expect((await readGitHistory(tmp, "Button.tsx"))?.authorsCount).toBe(1);
  });

  it("레포가 아니면 예외 없이 null", async () => {
    fs.writeFileSync(path.join(tmp, "Button.tsx"), "x");
    expect(await readGitHistory(tmp, "Button.tsx")).toBeNull();
  });

  it("존재하지 않는(추적 안 되는) 파일이면 null", async () => {
    git("init", "-q");
    commit("a@t", "2025-01-01T00:00:00+00:00", "one");
    expect(await readGitHistory(tmp, "Nope.tsx")).toBeNull();
  });

  it("git 실행 파일이 없으면 예외 없이 null", async () => {
    git("init", "-q");
    commit("a@t", "2025-01-01T00:00:00+00:00", "one");
    const saved = process.env.PATH;
    process.env.PATH = path.join(tmp, "no-such-bin");
    try {
      expect(await readGitHistory(tmp, "Button.tsx")).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.PATH;
      else process.env.PATH = saved;
    }
  });
});

describe("readGitHistory 타임아웃", () => {
  it("timeoutMs 안에 끝나지 않으면 null", async () => {
    git("init", "-q");
    commit("a@t", "2025-01-01T00:00:00+00:00", "one");
    expect(await readGitHistory(tmp, "Button.tsx", { timeoutMs: 1 })).toBeNull();
  });
});
