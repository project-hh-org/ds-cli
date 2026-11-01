import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "../src/git/run.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-gitrun-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("runGit", () => {
  it("git init은 ok이고 stdout을 돌려준다", async () => {
    const r = await runGit(tmp, ["init", "-q"]);
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    const inside = await runGit(tmp, ["rev-parse", "--is-inside-work-tree"]);
    expect(inside).toMatchObject({ ok: true, stdout: "true\n" });
  });

  it("레포가 아닌 곳은 ok:false(예외 없음)", async () => {
    const r = await runGit(tmp, ["rev-parse", "--git-dir"], { timeoutMs: 5000 });
    // 임시 디렉터리가 우연히 다른 레포 안일 수 있으므로 GIT_CEILING_DIRECTORIES로 막는다
    const env = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(tmp);
    try {
      const strict = await runGit(tmp, ["rev-parse", "--git-dir"]);
      expect(strict.ok).toBe(false);
      expect(typeof strict.code).toBe("number");
    } finally {
      if (env === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = env;
    }
    expect(typeof r.ok).toBe("boolean");
  });

  it("git이 없으면 ok:false, code null", async () => {
    const path0 = process.env.PATH;
    process.env.PATH = "";
    try {
      const r = await runGit(tmp, ["--version"]);
      expect(r).toMatchObject({ ok: false, code: null });
    } finally {
      process.env.PATH = path0;
    }
  });

  it("input을 표준 입력으로 넘긴다", async () => {
    await runGit(tmp, ["init", "-q"]);
    const r = await runGit(tmp, ["hash-object", "--stdin"], { input: "hello\n" });
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
  });
});
