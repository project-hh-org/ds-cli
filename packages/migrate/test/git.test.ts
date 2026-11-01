import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abandonBranch, checkBranch, commitFiles, commitMessage, createBranch, parseGitVersion } from "../src/git.js";

const KEYS = ["HOME", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "EMAIL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "XDG_CONFIG_HOME"];
const saved: Record<string, string | undefined> = {};
const dirs: string[] = [];

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-githome-"));
  dirs.push(home);
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = path.join(home, "nope");
  for (const k of ["EMAIL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args], { cwd, encoding: "utf-8" });

/** 커밋 하나가 있는 레포. identity=true면 레포 로컬 user.name/email을 설정한다 */
function repo(identity: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-gitrepo-"));
  dirs.push(root);
  git(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(root, "b.ts"), "export const b = 1;\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  if (identity) {
    git(root, "config", "user.name", "Repo Author");
    git(root, "config", "user.email", "repo@example.com");
  } else {
    git(root, "config", "user.useConfigOnly", "true");
  }
  return root;
}

describe("commitMessage", () => {
  it("토큰만 / 컴포넌트 포함", () => {
    expect(commitMessage(12, 0)).toBe("chore(ds): 하드코딩 12건을 토큰으로 치환 (dsmith migrate)");
    expect(commitMessage(12, 3)).toBe("chore(ds): 하드코딩 12건을 토큰으로, 컴포넌트 import 3건을 DS로 치환 (dsmith migrate)");
  });
});

describe("checkBranch / createBranch / commitFiles", () => {
  it("깨끗한 트리: 브랜치 생성·커밋 — 메시지, .dsmith 미포함, 작성자는 레포 user.name", async () => {
    const root = repo(true);
    const baseSha = git(root, "rev-parse", "HEAD").trim();
    const check = await checkBranch(root, "ds/migrate-test", ["a.ts"]);
    expect(check).toEqual({ ok: true, base: "main", baseSha });

    await createBranch(root, "ds/migrate-test");
    expect(git(root, "branch", "--show-current").trim()).toBe("ds/migrate-test");
    fs.writeFileSync(path.join(root, "a.ts"), "export const a = 2;\n");
    fs.mkdirSync(path.join(root, ".dsmith"));
    fs.writeFileSync(path.join(root, ".dsmith", "x.json"), "{}");
    fs.writeFileSync(path.join(root, "b.ts"), "export const b = 2; // 대상 아님\n");
    git(root, "add", "b.ts"); // 인덱스에 다른 스테이징이 있어도 섞이지 않는다

    const sha = await commitFiles(root, ["a.ts"], commitMessage(1, 0));
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(root, "rev-parse", "HEAD").trim()).toBe(sha);
    expect(git(root, "log", "-1", "--format=%s%n%an <%ae>").trim()).toBe(
      "chore(ds): 하드코딩 1건을 토큰으로 치환 (dsmith migrate)\nRepo Author <repo@example.com>",
    );
    expect(git(root, "show", "--name-only", "--format=", "HEAD").trim()).toBe("a.ts");
    expect(git(root, "status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual(["?? .dsmith/", "M  b.ts"]);
  });

  it("작성자 정보가 없으면 쓰기 전에 오류", async () => {
    const root = repo(false);
    const check = await checkBranch(root, "ds/x", ["a.ts"]);
    expect(check.ok).toBe(false);
    expect(!check.ok && check.reason).toContain("작성자");
    expect(git(root, "branch", "--list", "ds/x")).toBe("");
  });

  it("같은 이름의 브랜치가 있으면 오류", async () => {
    const root = repo(true);
    git(root, "branch", "ds/x");
    const check = await checkBranch(root, "ds/x", ["a.ts"]);
    expect(!check.ok && check.reason).toContain("이미 있음");
  });

  it("대상 파일이 dirty면 오류, 대상이 아닌 파일의 변경은 허용", async () => {
    const root = repo(true);
    fs.writeFileSync(path.join(root, "b.ts"), "// 손댐\n");
    expect((await checkBranch(root, "ds/x", ["a.ts"])).ok).toBe(true);
    fs.writeFileSync(path.join(root, "a.ts"), "// 손댐\n");
    const check = await checkBranch(root, "ds/x", ["a.ts"]);
    expect(!check.ok && check.reason).toContain("a.ts");
  });

  it("토큰 파일이 untracked·수정이면 오류(목록·힌트), 깨끗하면 통과 (I2)", async () => {
    const root = repo(true);
    fs.writeFileSync(path.join(root, "tokens.css"), ":root { --a: 1px; }\n");
    fs.writeFileSync(path.join(root, "preset.ts"), "export default {};\n");
    git(root, "add", "preset.ts");
    git(root, "commit", "-q", "-m", "preset");
    const untracked = await checkBranch(root, "ds/x", ["a.ts"], { tokenFiles: ["tokens.css", "preset.ts"] });
    expect(!untracked.ok && untracked.reason).toContain("tokens.css");
    expect(!untracked.ok && untracked.reason).not.toContain("preset.ts");
    expect(!untracked.ok && untracked.reason).toContain("먼저 커밋하거나 --with-tokens로 함께 커밋");

    fs.appendFileSync(path.join(root, "preset.ts"), "// 수정\n");
    const both = await checkBranch(root, "ds/x", ["a.ts"], { tokenFiles: ["tokens.css", "preset.ts"] });
    expect(!both.ok && both.reason).toMatch(/tokens\.css.*preset\.ts|preset\.ts.*tokens\.css/);

    git(root, "add", "tokens.css", "preset.ts");
    git(root, "commit", "-q", "-m", "tokens");
    expect((await checkBranch(root, "ds/x", ["a.ts"], { tokenFiles: ["tokens.css", "preset.ts"] })).ok).toBe(true);
  });

  it("withTokens: untracked·수정된 토큰 파일을 include로 돌려주고, 무시되는 파일은 오류", async () => {
    const root = repo(true);
    fs.writeFileSync(path.join(root, "tokens.css"), ":root { --a: 1px; }\n");
    fs.writeFileSync(path.join(root, "tokens.json"), "{}\n");
    git(root, "add", "tokens.json");
    git(root, "commit", "-q", "-m", "json");
    fs.appendFileSync(path.join(root, "tokens.json"), "\n");
    fs.mkdirSync(path.join(root, ".dsmith"));
    fs.writeFileSync(path.join(root, ".dsmith", "x.json"), "{}");
    const check = await checkBranch(root, "ds/x", ["a.ts"], { tokenFiles: ["tokens.css", "tokens.json", ".dsmith/x.json"], withTokens: true });
    expect(check).toMatchObject({ ok: true, include: ["tokens.css", "tokens.json"] });

    fs.writeFileSync(path.join(root, ".gitignore"), "tokens.css\n");
    const ignored = await checkBranch(root, "ds/x", ["a.ts"], { tokenFiles: ["tokens.css"], withTokens: true });
    expect(!ignored.ok && ignored.reason).toContain(".gitignore");
  });

  it("git 레포가 아니면 오류", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-nogit-"));
    dirs.push(root);
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(root);
    try {
      const check = await checkBranch(root, "ds/x", []);
      expect(!check.ok && check.reason).toContain("git 작업 트리가 아님");
    } finally {
      delete process.env.GIT_CEILING_DIRECTORIES;
    }
  });

  it("잘못된 브랜치 이름은 오류", async () => {
    const root = repo(true);
    const check = await checkBranch(root, "bad name~", []);
    expect(check.ok).toBe(false);
  });

  it("분리 HEAD면 base는 sha", async () => {
    const root = repo(true);
    const sha = git(root, "rev-parse", "HEAD").trim();
    git(root, "switch", "--detach", sha);
    expect(await checkBranch(root, "ds/x", [])).toEqual({ ok: true, base: sha, baseSha: sha });
  });

  it("abandonBranch는 base로 돌아가 브랜치를 지운다", async () => {
    const root = repo(true);
    await createBranch(root, "ds/gone");
    await abandonBranch(root, "main", "ds/gone");
    expect(git(root, "branch", "--show-current").trim()).toBe("main");
    expect(git(root, "branch", "--list", "ds/gone")).toBe("");
  });

  it("git 2.23 미만이면 쓰기 전에 'git 2.23 이상 필요' 오류", async () => {
    const root = repo(true);
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-fakegit-"));
    dirs.push(bin);
    const real = execFileSync("which", ["git"], { encoding: "utf-8" }).trim();
    fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version 2.20.1"; exit 0; fi\nexec ${real} "$@"\n`, { mode: 0o755 });
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ""}`;
    try {
      const check = await checkBranch(root, "ds/x", ["a.ts"]);
      expect(check.ok).toBe(false);
      expect(!check.ok && check.reason).toContain("git 2.23 이상 필요");
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it("버전 문자열 해석", () => {
    expect(parseGitVersion("git version 2.39.2\n")).toEqual([2, 39]);
    expect(parseGitVersion("git version 2.37.1 (Apple Git-137.1)")).toEqual([2, 37]);
    expect(parseGitVersion("???")).toBeNull();
  });

  it(".gitignore에 걸리는 대상 파일은 쓰기 전에 오류, 추적 중인 파일은 허용", async () => {
    const root = repo(true);
    fs.writeFileSync(path.join(root, ".gitignore"), "gen/\nb.ts\n");
    fs.mkdirSync(path.join(root, "gen"));
    fs.writeFileSync(path.join(root, "gen", "c.ts"), "export const c = 1;\n");
    git(root, "add", ".gitignore");
    git(root, "commit", "-q", "-m", "ignore");
    const ignored = await checkBranch(root, "ds/x", ["a.ts", "gen/c.ts"]);
    expect(ignored.ok).toBe(false);
    expect(!ignored.ok && ignored.reason).toContain("gen/c.ts");
    expect(!ignored.ok && ignored.reason).toContain(".gitignore");
    // b.ts는 이미 추적 중이라 무시 규칙에 걸려도 add·commit 된다
    expect((await checkBranch(root, "ds/x", ["a.ts", "b.ts"])).ok).toBe(true);
  });

  it("환경에 GIT_DIR·GIT_WORK_TREE가 있어도 root의 레포에서 일한다", async () => {
    const root = repo(true);
    const other = repo(true);
    fs.writeFileSync(path.join(other, "other.ts"), "x\n");
    git(other, "add", "other.ts");
    git(other, "commit", "-q", "-m", "other");
    const rootSha = git(root, "rev-parse", "HEAD").trim();
    expect(git(other, "rev-parse", "HEAD").trim()).not.toBe(rootSha);
    process.env.GIT_DIR = path.join(other, ".git");
    process.env.GIT_WORK_TREE = other;
    try {
      expect(await checkBranch(root, "ds/amb", ["a.ts"])).toEqual({ ok: true, base: "main", baseSha: rootSha });
      await createBranch(root, "ds/amb");
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.GIT_WORK_TREE;
    }
    expect(git(root, "branch", "--show-current").trim()).toBe("ds/amb");
    expect(git(other, "branch", "--list", "ds/amb")).toBe("");
  });
});
