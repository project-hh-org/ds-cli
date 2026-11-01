import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLI_BIN, MONOREPO_ROOT, defaultInstallTool, makeRunCopy, prepareBase, prepareCondition, type Base } from "../src/base.js";
import { cleanupTmps, git, tmpDir } from "./helpers.js";

afterAll(cleanupTmps);

function listFiles(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...listFiles(root, r));
    else out.push(r);
  }
  return out.sort();
}

describe("prepareBase / prepareCondition / makeRunCopy", () => {
  let base: Base;
  let baseline: string;
  let dsmith: string;

  beforeAll(async () => {
    base = await prepareBase("legacy-demo");
    baseline = await prepareCondition(base, "baseline", "claude-code");
    dsmith = await prepareCondition(base, "dsmith", "claude-code");
  }, 120_000);

  afterAll(() => {
    for (const d of [base?.dir, baseline, dsmith]) if (d !== undefined) fs.rmSync(d, { recursive: true, force: true });
  });

  it("베이스: 모노레포 밖, benchmarks/ 없음, audit → init --all → ai 결과(.dsmith/catalog.json)와 토큰 14·DS module 4·컴포넌트 6", () => {
    expect(path.relative(MONOREPO_ROOT, base.dir).startsWith("..")).toBe(true);
    expect(fs.existsSync(path.join(base.dir, "benchmarks"))).toBe(false);
    expect(fs.existsSync(path.join(base.dir, ".dsmith/catalog.json"))).toBe(true);
    expect(fs.existsSync(path.join(base.dir, "design-system/tokens.json"))).toBe(true);
    expect(base.snapshot.tokens).toHaveLength(14);
    expect(base.snapshot.ds.modules).toHaveLength(4);
    expect(base.snapshot.ds.components).toHaveLength(6);
    expect(base.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("baseline: .dsmith·.mcp.json·AGENTS.md(DS 섹션뿐이라 파일째)·.claude 없음, 토큰 파일은 있음", () => {
    expect(fs.existsSync(path.join(baseline, ".dsmith"))).toBe(false);
    expect(fs.existsSync(path.join(baseline, ".mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(baseline, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(baseline, ".claude"))).toBe(false);
    expect(fs.existsSync(path.join(baseline, "benchmarks"))).toBe(false);
    expect(fs.existsSync(path.join(baseline, "design-system/tokens.css"))).toBe(true);
  });

  it("dsmith: AGENTS.md DS 섹션, .mcp.json(node + 로컬 빌드 CLI), 스킬, .dsmith 있음 / benchmarks/ 없음", () => {
    expect(fs.readFileSync(path.join(dsmith, "AGENTS.md"), "utf-8")).toContain("<!-- dsmith:ds:start -->");
    const mcp = JSON.parse(fs.readFileSync(path.join(dsmith, ".mcp.json"), "utf-8")) as { mcpServers: { dsmith: { command: string; args: string[] } } };
    expect(mcp.mcpServers.dsmith.command).toBe("node");
    expect(mcp.mcpServers.dsmith.args[0]).toBe(CLI_BIN);
    expect(fs.existsSync(path.join(dsmith, ".claude/skills/ds/SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dsmith, ".dsmith/catalog.json"))).toBe(true);
    expect(fs.existsSync(path.join(dsmith, "benchmarks"))).toBe(false);
    expect(path.relative(MONOREPO_ROOT, dsmith).startsWith("..")).toBe(true);
  });

  it("공정성: 두 조건의 차이는 .claude·.dsmith·.mcp.json·AGENTS.md 뿐이다", () => {
    const a = new Set(listFiles(baseline));
    const b = new Set(listFiles(dsmith));
    const onlyIn = (x: Set<string>, y: Set<string>): string[] => [...x].filter((f) => !y.has(f));
    expect(onlyIn(a, b)).toEqual([]);
    const extra = onlyIn(b, a).filter((f) => !f.startsWith(".claude/") && !f.startsWith(".dsmith/") && f !== ".mcp.json" && f !== "AGENTS.md");
    expect(extra).toEqual([]);
    // 공통 소스는 바이트 같다
    for (const f of a) expect(fs.readFileSync(path.join(baseline, f))).toEqual(fs.readFileSync(path.join(dsmith, f)));
  });

  it("baseline은 AGENTS.md의 다른 내용은 남기고 dsmith 섹션만 뺀다", async () => {
    const dir = tmpDir("dsmith-bench-agentsmd-");
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# 내 규칙\n\n- 커밋 전에 린트\n\n<!-- dsmith:ds:start -->\nDS 섹션\n<!-- dsmith:ds:end -->\n");
    fs.mkdirSync(path.join(dir, ".dsmith"));
    fs.writeFileSync(path.join(dir, ".mcp.json"), "{}");
    const out = await prepareCondition({ dir } as Base, "baseline", "claude-code");
    try {
      expect(fs.readFileSync(path.join(out, "AGENTS.md"), "utf-8")).toBe("# 내 규칙\n\n- 커밋 전에 린트\n");
      expect(fs.existsSync(path.join(out, ".dsmith"))).toBe(false);
      expect(fs.existsSync(path.join(out, ".mcp.json"))).toBe(false);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it("makeRunCopy: git 레포 + 기준 커밋 'bench base', 작업 트리 깨끗, 템플릿은 그대로", async () => {
    const copy = await makeRunCopy(dsmith);
    try {
      expect(copy).not.toBe(dsmith);
      expect(path.relative(MONOREPO_ROOT, copy).startsWith("..")).toBe(true);
      expect(git(copy, "status", "--porcelain").trim()).toBe("");
      expect(git(copy, "log", "-1", "--format=%s").trim()).toBe("bench base");
      expect(git(copy, "branch", "--show-current").trim()).toBe("main");
      expect(fs.existsSync(path.join(copy, ".mcp.json"))).toBe(true);
      expect(fs.existsSync(path.join(dsmith, ".git"))).toBe(false);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  it("TMPDIR이 모노레포 아래면 Error", async () => {
    const prev = process.env.TMPDIR;
    process.env.TMPDIR = path.join(MONOREPO_ROOT, "benchmarks/dist");
    try {
      await expect(makeRunCopy(baseline)).rejects.toThrow(/모노레포 아래/);
    } finally {
      if (prev === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prev;
    }
  });
});

describe("defaultInstallTool", () => {
  it("에이전트 명령 첫 단어로 정한다", () => {
    expect(defaultInstallTool("claude -p --model sonnet")).toBe("claude-code");
    expect(defaultInstallTool("/opt/node22/bin/claude -p")).toBe("claude-code");
    expect(defaultInstallTool("codex exec")).toBe("codex");
    expect(defaultInstallTool("node fake-agent.mjs")).toBe("agents-md");
  });
});
