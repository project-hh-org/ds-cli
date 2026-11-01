import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "../src/commands/audit.js";
import { runInitCommand } from "../src/commands/init.js";
import { buildProgram } from "../src/program.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const bin = path.resolve(here, "../dist/bin.js");

const git = (root: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf-8" });
const dsmith = (root: string, ...args: string[]) => spawnSync(process.execPath, [bin, ...args, ...(args[0] === "guard" ? [] : [])], { cwd: root, encoding: "utf-8" });

let base: string;
const tmps: string[] = [];
beforeAll(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-guard-cli-")));
  fs.cpSync(path.join(repoRoot, "examples/legacy-demo"), base, { recursive: true, filter: (p) => !p.split(path.sep).includes(".dsmith") });
  fs.writeFileSync(path.join(base, "eslint.config.mjs"), 'export default [\n  { rules: {} },\n];\n');
  await runAudit(base);
  await runInitCommand({ root: base, all: true });
  await runAudit(base);
}, 120_000);
afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
});

function clone(): string {
  const to = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-guard-cli-c-")));
  tmps.push(to);
  fs.cpSync(base, to, { recursive: true });
  return to;
}

describe("dsmith guard", () => {
  it("guard 서브커맨드와 init 하위 명령이 등록돼 있다", () => {
    const guard = buildProgram().commands.find((c) => c.name() === "guard");
    expect(guard?.commands.map((c) => c.name())).toEqual(["init"]);
    expect(guard?.options.map((o) => o.long)).toEqual(expect.arrayContaining(["--ci", "--base", "--comment", "--json", "--root"]));
    expect(guard?.commands[0]?.options.map((o) => o.long)).toEqual(expect.arrayContaining(["--ci", "--dry-run", "--force", "--json", "--root"]));
  });

  it("guard init --json 은 GuardInitResult를 낸다(--ci github 값이 init에 전달됨)", () => {
    const root = clone();
    const r = dsmith(root, "guard", "init", "--ci", "github", "--json");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { snapshot: string; workflow: string | null; eslint: string; counts: { tokens: number } };
    expect(out.snapshot).toBe(".dsmith/guard.json");
    expect(out.workflow).toBe(".github/workflows/dsmith-guard.yml");
    expect(out.eslint).toBe("insert");
    expect(out.counts.tokens).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, ".github/workflows/dsmith-guard.yml"))).toBe(true);
  });

  it("guard --ci --base main --json: 신규 하드코딩이면 종료 코드 1, 없으면 0", () => {
    const root = clone();
    expect(dsmith(root, "guard", "init", "--json").status).toBe(0);
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "switch", "-q", "-c", "feat");

    fs.writeFileSync(path.join(root, "README.md"), "# docs\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "docs");
    const clean = dsmith(root, "guard", "--ci", "--base", "main", "--json");
    expect(clean.status).toBe(0);
    expect(JSON.parse(clean.stdout).counts.newHardcoded).toBe(0);

    fs.writeFileSync(path.join(root, "src/components/Extra.tsx"), 'export const Extra = () => <div style={{ color: "#3c83f7", backgroundColor: "#ef4444" }} />;\n');
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "extra");
    const dirty = dsmith(root, "guard", "--ci", "--base", "main", "--json");
    expect(dirty.status).toBe(1);
    const out = JSON.parse(dirty.stdout) as { counts: { newHardcoded: number }; exitCode: number; body: string; comment: unknown };
    expect(out.counts.newHardcoded).toBe(2);
    expect(out.exitCode).toBe(1);
    expect(out.comment).toBeNull();

    const human = dsmith(root, "guard", "--ci", "--base", "main");
    expect(human.status).toBe(1);
    expect(human.stdout.startsWith("<!-- dsmith:guard -->")).toBe(true);
  });

  it("--comment가 실패해도(토큰 없음) 종료 코드는 정책대로, stderr에 경고", () => {
    const root = clone();
    dsmith(root, "guard", "init");
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "switch", "-q", "-c", "feat");
    fs.writeFileSync(path.join(root, "src/components/Extra.tsx"), 'export const Extra = () => <div style={{ color: "#3c83f7" }} />;\n');
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "extra");
    const r = spawnSync(process.execPath, [bin, "guard", "--ci", "--base", "main", "--comment"], {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, GITHUB_TOKEN: "", GITHUB_REPOSITORY: "", GITHUB_EVENT_PATH: "" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("경고: PR 코멘트를 달지 못했습니다");
  });

  it("--base 없이 --ci, guard.json 없음, base ref 없음은 오류(종료 1)", () => {
    const root = clone();
    const noBase = dsmith(root, "guard", "--ci");
    expect(noBase.status).toBe(1);
    expect(noBase.stderr).toContain("--base");
    const noSnapshot = dsmith(root, "guard", "--ci", "--base", "main");
    expect(noSnapshot.stderr).toContain("dsmith guard init");
    dsmith(root, "guard", "init");
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    const noRef = dsmith(root, "guard", "--ci", "--base", "origin/main");
    expect(noRef.status).toBe(1);
    expect(noRef.stderr).toContain("fetch-depth: 0");
  });
});
