import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AI_TOOLS, detectTools, normalizeTools } from "../src/detect-tools.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup(repo: string[], home: string[]): { root: string; home: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-detect-tools-"));
  tmpDirs.push(base);
  const root = path.join(base, "repo");
  const homeDir = path.join(base, "home");
  fs.mkdirSync(root);
  fs.mkdirSync(homeDir);
  for (const [dir, entries] of [
    [root, repo],
    [homeDir, home],
  ] as const) {
    for (const e of entries) {
      if (e.endsWith("/")) fs.mkdirSync(path.join(dir, e), { recursive: true });
      else fs.writeFileSync(path.join(dir, e), "");
    }
  }
  return { root, home: homeDir };
}

describe("detectTools", () => {
  it("빈 root/home이면 기본값 claude-code + agents-md", async () => {
    const { root, home } = setup([], []);
    const d = await detectTools(root, home);
    expect(d.tools).toEqual(["claude-code", "agents-md"]);
    expect(d.defaulted).toBe(true);
    expect(d.evidence).toEqual({});
  });

  it("레포 흔적: .claude/ · CLAUDE.md → claude-code", async () => {
    for (const trace of [".claude/", "CLAUDE.md"]) {
      const { root, home } = setup([trace], []);
      const d = await detectTools(root, home);
      expect(d.tools, trace).toEqual(["claude-code"]);
      expect(d.defaulted).toBe(false);
      expect(d.evidence["claude-code"], trace).toEqual([trace]);
    }
  });

  it("레포 흔적: .cursor/ → cursor, .gemini/ → gemini", async () => {
    const { root, home } = setup([".cursor/", ".gemini/"], []);
    expect((await detectTools(root, home)).tools).toEqual(["cursor", "gemini"]);
  });

  it(".agents/만 있으면 codex + agents-md", async () => {
    const { root, home } = setup([".agents/"], []);
    const d = await detectTools(root, home);
    expect(d.tools).toEqual(["codex", "agents-md"]);
    expect(d.evidence.codex).toEqual([".agents/"]);
  });

  it("AGENTS.md · .codex/ → codex", async () => {
    for (const trace of ["AGENTS.md", ".codex/"]) {
      const { root, home } = setup([trace], []);
      expect((await detectTools(root, home)).tools, trace).toEqual(["codex", "agents-md"]);
    }
  });

  it("홈 흔적: ~/.claude/ ~/.codex/ ~/.cursor/ ~/.gemini/", async () => {
    const { root, home } = setup([], [".claude/", ".codex/", ".cursor/", ".gemini/"]);
    const d = await detectTools(root, home);
    expect(d.tools).toEqual(["claude-code", "codex", "cursor", "gemini", "agents-md"]);
    expect(d.evidence["claude-code"]).toEqual(["~/.claude/"]);
    expect(d.evidence.gemini).toEqual(["~/.gemini/"]);
  });

  it("레포·홈 증거를 합치고 중복 도구는 한 번만", async () => {
    const { root, home } = setup([".claude/"], [".claude/", ".cursor/"]);
    const d = await detectTools(root, home);
    expect(d.tools).toEqual(["claude-code", "cursor"]);
    expect(d.evidence["claude-code"]).toEqual([".claude/", "~/.claude/"]);
  });

  it("같은 이름의 일반 파일은 디렉터리 흔적으로 치지 않는다", async () => {
    const { root, home } = setup([".claude", "CLAUDE.md/"], []);
    const d = await detectTools(root, home);
    expect(d.defaulted).toBe(true);
  });
});

describe("normalizeTools", () => {
  it("codex가 있으면 agents-md를 더한다", () => {
    expect(normalizeTools(["codex"])).toEqual(["codex", "agents-md"]);
  });

  it("AI_TOOLS 순서로 정렬하고 중복을 없앤다", () => {
    expect(normalizeTools(["gemini", "claude-code", "gemini", "cursor"])).toEqual(["claude-code", "cursor", "gemini"]);
  });

  it("agents-md만 줘도 그대로", () => {
    expect(normalizeTools(["agents-md"])).toEqual(["agents-md"]);
  });

  it("AI_TOOLS는 5개", () => {
    expect([...AI_TOOLS]).toEqual(["claude-code", "codex", "cursor", "gemini", "agents-md"]);
  });
});
