import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { loadCommands, type CommandSource } from "../src/commands.js";
import { AI_TOOLS } from "../src/detect-tools.js";
import { defaultMcpLaunch } from "../src/mcp-launch.js";
import { renderers } from "../src/index.js";
import {
  MANAGED_NOTICE,
  MD_MARKERS,
  TOML_MARKERS,
  mcpServerEntry,
  substituteArgs,
  type RenderContext,
} from "../src/renderers/shared.js";

const mcp = defaultMcpLaunch("0.2.0");
const repoCtx: RenderContext = { root: "/r", home: "/h", scope: "repo", mcp };
const globalCtx: RenderContext = { ...repoCtx, scope: "global" };

/** 스냅샷용 고정 명령 — 실제 명령 소스 본문이 바뀌어도 스냅샷이 흔들리지 않게 한다. */
const FIXTURES: CommandSource[] = [
  {
    name: "ds-sample",
    description: '샘플: "따옴표"와 콜론이 있는 설명. 두 번째 문장.',
    args: "[--root <dir>]",
    uses: ["cli:audit"],
    body: "`npx dsmith audit --json {{args}}` 를 실행한다.\n\n- 항목 하나",
  },
  {
    name: "ds-mcp-only",
    description: "MCP 도구만 쓰는 명령.",
    uses: ["mcp:lint_snippet"],
    body: "lint_snippet을 부른다.",
  },
  {
    name: "ds-todo",
    description: "아직 없는 명령.",
    uses: [],
    body: "아직 제공되지 않음.",
  },
];

const names = (tool: keyof typeof renderers, ctx: RenderContext, cmds = FIXTURES): string[] =>
  renderers[tool].render(cmds, ctx).writes.map((w) => w.file);

describe("shared", () => {
  it("substituteArgs는 {{args}}를 치환하고 $ 패턴을 해석하지 않는다", () => {
    expect(substituteArgs("a {{args}} b", "$ARGUMENTS")).toBe("a $ARGUMENTS b");
    expect(substituteArgs("a {{args}} b", "$&")).toBe("a $& b");
    expect(substituteArgs("no args", "x")).toBe("no args");
  });

  it("mcpServerEntry는 extra를 앞에 두고 command·args를 덧붙인다", () => {
    expect(Object.keys(mcpServerEntry(mcp, { type: "stdio" }))).toEqual(["type", "command", "args"]);
    expect(mcpServerEntry(mcp)).toEqual({ command: "npx", args: ["-y", "dsmith@0.2", "mcp"] });
  });

  it("마커 상수", () => {
    expect(MD_MARKERS).toEqual({ start: "<!-- dsmith:start -->", end: "<!-- dsmith:end -->" });
    expect(TOML_MARKERS).toEqual({ start: "# dsmith:start", end: "# dsmith:end" });
  });

  it("renderers는 AI_TOOLS 5개를 모두 갖고 verified에 날짜·URL이 있다", () => {
    expect(Object.keys(renderers).sort()).toEqual([...AI_TOOLS].sort());
    for (const tool of AI_TOOLS) {
      const r = renderers[tool];
      expect(r.tool).toBe(tool);
      expect(r.verified.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.verified.urls.length).toBeGreaterThan(0);
      for (const url of r.verified.urls) expect(url).toMatch(/^https:\/\//);
    }
  });
});

describe("스냅샷 (repo scope)", () => {
  for (const tool of AI_TOOLS) {
    it(`${tool}`, () => {
      expect(renderers[tool].render(FIXTURES, repoCtx)).toMatchSnapshot();
    });
  }
});

describe("스냅샷 (global scope)", () => {
  for (const tool of ["claude-code", "codex"] as const) {
    it(`${tool}`, () => {
      expect(renderers[tool].render(FIXTURES, globalCtx)).toMatchSnapshot();
    });
  }
});

function skillFrontmatter(content: string): Record<string, unknown> {
  expect(content.startsWith("---\n")).toBe(true);
  const end = content.indexOf("\n---\n", 4);
  return parse(content.slice(4, end)) as Record<string, unknown>;
}

describe("claude-code", () => {
  const out = renderers["claude-code"].render(FIXTURES, repoCtx);
  const sample = out.writes.find((w) => w.file === "/r/.claude/skills/ds-sample/SKILL.md");

  it("스킬 경로와 .mcp.json json-key", () => {
    expect(names("claude-code", repoCtx)).toEqual([
      "/r/.claude/skills/ds-sample/SKILL.md",
      "/r/.claude/skills/ds-mcp-only/SKILL.md",
      "/r/.claude/skills/ds-todo/SKILL.md",
      "/r/.mcp.json",
    ]);
    const mcpWrite = out.writes.at(-1);
    expect(mcpWrite?.region).toEqual({ kind: "json-key", keyPath: ["mcpServers", "dsmith"] });
    expect(JSON.parse(mcpWrite?.content ?? "")).toEqual({ command: "npx", args: ["-y", "dsmith@0.2", "mcp"] });
  });

  it("args가 있으면 argument-hint와 $ARGUMENTS", () => {
    expect(sample?.region).toEqual({ kind: "file" });
    expect(sample?.content).toContain("$ARGUMENTS");
    expect(sample?.content).not.toContain("{{args}}");
    const fm = skillFrontmatter(sample?.content ?? "");
    expect(fm["argument-hint"]).toBe("[--root <dir>]");
    expect(fm["name"]).toBe("ds-sample");
    expect(fm["description"]).toBe(FIXTURES[0]?.description);
  });

  it("args가 없으면 argument-hint를 넣지 않는다", () => {
    const only = out.writes.find((w) => w.file.includes("ds-mcp-only"));
    expect(skillFrontmatter(only?.content ?? "")).not.toHaveProperty("argument-hint");
  });

  it("버전 문자열을 넣지 않고 MANAGED_NOTICE를 단다", () => {
    expect(sample?.content).toContain(`<!-- ${MANAGED_NOTICE} -->`);
    expect(sample?.content).not.toMatch(/0\.2\.0/);
  });

  it("global: ~/.claude/skills, MCP는 쓰지 않고 claude mcp add 안내 note", () => {
    const g = renderers["claude-code"].render(FIXTURES, globalCtx);
    expect(g.writes.map((w) => w.file)).toEqual([
      "/h/.claude/skills/ds-sample/SKILL.md",
      "/h/.claude/skills/ds-mcp-only/SKILL.md",
      "/h/.claude/skills/ds-todo/SKILL.md",
    ]);
    expect(g.notes.join("\n")).toContain("claude mcp add --scope user dsmith -- npx -y dsmith@0.2 mcp");
  });
});

describe("codex", () => {
  const out = renderers.codex.render(FIXTURES, repoCtx);

  it("스킬은 .agents/skills, frontmatter name = 디렉터리 이름, argument-hint 없음", () => {
    for (const w of out.writes.filter((x) => x.file.endsWith("SKILL.md"))) {
      const dir = w.file.split("/").at(-2);
      const fm = skillFrontmatter(w.content);
      expect(fm["name"]).toBe(dir);
      expect(fm).not.toHaveProperty("argument-hint");
      expect(w.file.startsWith("/r/.agents/skills/")).toBe(true);
    }
  });

  it("{{args}}를 자리표시자 `<사용자가 함께 준 인자, 없으면 생략>`으로 치환한다", () => {
    const sample = out.writes.find((w) => w.file.includes("ds-sample"));
    expect(sample?.content).toContain("<사용자가 함께 준 인자, 없으면 생략>");
    expect(sample?.content).not.toContain("{{args}}");
  });

  it("repo: .codex/config.toml 블록 + 신뢰 프로젝트 note", () => {
    const cfg = out.writes.find((w) => w.file === "/r/.codex/config.toml");
    expect(cfg?.region).toEqual({ kind: "block", start: "# dsmith:start", end: "# dsmith:end" });
    expect(cfg?.content).toBe('[mcp_servers.dsmith]\ncommand = "npx"\nargs = ["-y", "dsmith@0.2", "mcp"]\n');
    expect(out.notes.join("\n")).toContain("신뢰한 프로젝트");
  });

  it("global: ~/.agents/skills와 ~/.codex/config.toml", () => {
    const g = renderers.codex.render(FIXTURES, globalCtx);
    expect(g.writes.map((w) => w.file)).toEqual([
      "/h/.agents/skills/ds-sample/SKILL.md",
      "/h/.agents/skills/ds-mcp-only/SKILL.md",
      "/h/.agents/skills/ds-todo/SKILL.md",
      "/h/.codex/config.toml",
    ]);
  });

  it("AGENTS.md는 쓰지 않는다(agents-md 렌더러 몫)", () => {
    expect(names("codex", repoCtx).some((f) => f.endsWith("AGENTS.md"))).toBe(false);
  });
});

describe("cursor", () => {
  const out = renderers.cursor.render(FIXTURES, repoCtx);

  it("경로·MCP json-key(type stdio)", () => {
    expect(out.writes.map((w) => w.file)).toEqual([
      "/r/.cursor/commands/ds-sample.md",
      "/r/.cursor/commands/ds-mcp-only.md",
      "/r/.cursor/commands/ds-todo.md",
      "/r/.cursor/mcp.json",
    ]);
    const mcpWrite = out.writes.at(-1);
    expect(mcpWrite?.region).toEqual({ kind: "json-key", keyPath: ["mcpServers", "dsmith"] });
    expect(JSON.parse(mcpWrite?.content ?? "")).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "dsmith@0.2", "mcp"],
    });
  });

  it("명령 파일은 frontmatter 없는 마크다운 — 첫 줄이 '---'가 아니다", () => {
    for (const w of out.writes.filter((x) => x.file.endsWith(".md"))) {
      expect(w.content.split("\n")[0]).not.toBe("---");
      expect(w.content).not.toMatch(/^---$/m);
    }
  });

  it("{{args}}를 자리표시자 `<명령 뒤에 적은 내용, 없으면 생략>`으로 치환한다", () => {
    expect(out.writes[0]?.content).toContain("<명령 뒤에 적은 내용, 없으면 생략>");
  });
});

describe("gemini", () => {
  const out = renderers.gemini.render(FIXTURES, repoCtx);

  it("경로와 settings.json json-key", () => {
    expect(out.writes.map((w) => w.file)).toEqual([
      "/r/.gemini/commands/ds-sample.toml",
      "/r/.gemini/commands/ds-mcp-only.toml",
      "/r/.gemini/commands/ds-todo.toml",
      "/r/.gemini/settings.json",
    ]);
    const mcpWrite = out.writes.at(-1);
    expect(mcpWrite?.region).toEqual({ kind: "json-key", keyPath: ["mcpServers", "dsmith"] });
    expect(JSON.parse(mcpWrite?.content ?? "")).toEqual({ command: "npx", args: ["-y", "dsmith@0.2", "mcp"] });
  });

  it("toml에 description = 과 prompt = ''' 가 있고 {{args}}는 그대로", () => {
    const sample = out.writes[0]?.content ?? "";
    expect(sample).toContain("description = ");
    expect(sample).toContain("prompt = '''\n");
    expect(sample).toContain("{{args}}");
    expect(sample.endsWith("'''\n")).toBe(true);
  });

  it("description 이스케이프: JSON 문자열이 TOML 기본 문자열로 그대로 쓰인다", () => {
    const line = (out.writes[0]?.content ?? "").split("\n").find((l) => l.startsWith("description = ")) ?? "";
    expect(JSON.parse(line.slice("description = ".length))).toBe(FIXTURES[0]?.description);
  });

  it("body에 ''' 가 있으면 렌더 에러(명령 이름 포함)", () => {
    const bad: CommandSource = { name: "ds-bad", description: "x", uses: [], body: "a ''' b" };
    expect(() => renderers.gemini.render([bad], repoCtx)).toThrow(/ds-bad/);
  });

  it("body에 !{ 나 @{ 가 있으면 렌더 에러(Gemini가 셸·파일 주입으로 해석)", () => {
    for (const body of ["run !{ls}", "read @{file}"]) {
      const bad: CommandSource = { name: "ds-bad", description: "x", uses: [], body };
      expect(() => renderers.gemini.render([bad], repoCtx), body).toThrow(/ds-bad/);
    }
  });
});

describe("agents-md", () => {
  it("AGENTS.md 마커 블록 하나", () => {
    const out = renderers["agents-md"].render(FIXTURES, repoCtx);
    expect(out.writes).toHaveLength(1);
    expect(out.writes[0]?.file).toBe("/r/AGENTS.md");
    expect(out.writes[0]?.region).toEqual({
      kind: "block",
      start: "<!-- dsmith:start -->",
      end: "<!-- dsmith:end -->",
    });
  });

  it("슬래시 없을 때 열: cli 항목 → npx 명령, mcp만 → MCP 서버 필요, 없음 → 아직 없음", () => {
    const content = renderers["agents-md"].render(FIXTURES, repoCtx).writes[0]?.content ?? "";
    expect(content).toContain("`npx dsmith audit --json`");
    expect(content).toContain("MCP 서버 필요");
    expect(content).toContain("아직 없음");
  });
});

describe("실제 명령 8개 렌더 불변식", () => {
  it("모든 SKILL.md name이 agentskills 규칙을 통과하고 디렉터리 이름과 같다", async () => {
    const commands = await loadCommands();
    for (const tool of ["claude-code", "codex"] as const) {
      for (const w of renderers[tool].render(commands, repoCtx).writes.filter((x) => x.file.endsWith("SKILL.md"))) {
        const name = String(skillFrontmatter(w.content)["name"]);
        expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).toBe(w.file.split("/").at(-2));
        expect(String(skillFrontmatter(w.content)["description"]).length).toBeLessThanOrEqual(1024);
      }
    }
  });

  it("8개 명령 모두 5개 렌더러를 에러 없이 통과한다", async () => {
    const commands = await loadCommands();
    for (const tool of AI_TOOLS) expect(() => renderers[tool].render(commands, repoCtx), tool).not.toThrow();
    expect(renderers["claude-code"].render(commands, repoCtx).writes).toHaveLength(9);
    expect(renderers.gemini.render(commands, repoCtx).writes).toHaveLength(9);
  });

  it("agents-md 블록은 40줄 이하이고 명령 8행을 담는다", async () => {
    const commands = await loadCommands();
    const content = renderers["agents-md"].render(commands, repoCtx).writes[0]?.content ?? "";
    expect(content.trimEnd().split("\n").length).toBeLessThanOrEqual(40);
    const rows = content.split("\n").filter((l) => /^\| `?\/ds/.test(l));
    expect(rows).toHaveLength(8);
    expect(content).toContain("resolve_token, lint_snippet, search_component, get_component, explain_decision, list_decisions");
    expect(content).toContain("npx -y dsmith@0.2 mcp");
    expect(content).toContain('npx dsmith decide --item "<이름>" --choose "<id>"');
  });

  it("모든 write는 절대 경로이고 file/block/json-key 영역만 쓴다", async () => {
    const commands = await loadCommands();
    for (const tool of AI_TOOLS) {
      for (const w of renderers[tool].render(commands, repoCtx).writes) {
        expect(w.file.startsWith("/")).toBe(true);
        expect(["file", "block", "json-key"]).toContain(w.region.kind);
        if (w.region.kind === "json-key") expect(() => JSON.parse(w.content)).not.toThrow();
      }
    }
  });
});

describe("global scope", () => {
  it("supportsGlobal 플래그가 동작과 일치한다", () => {
    expect(renderers["claude-code"].supportsGlobal).toBe(true);
    expect(renderers.codex.supportsGlobal).toBe(true);
    for (const tool of ["cursor", "gemini", "agents-md"] as const) expect(renderers[tool].supportsGlobal).toBe(false);
  });

  it("cursor·gemini·agents-md는 writes [] + note 1개", () => {
    for (const tool of ["cursor", "gemini", "agents-md"] as const) {
      const out = renderers[tool].render(FIXTURES, globalCtx);
      expect(out.writes, tool).toEqual([]);
      expect(out.notes, tool).toHaveLength(1);
    }
  });
});

describe("실제 렌더 결과 구조 검사", () => {
  const tomlString = (line: string, key: string): unknown => {
    expect(line.startsWith(`${key} = `), line).toBe(true);
    return JSON.parse(line.slice(key.length + 3));
  };

  it("Gemini toml: ''' 는 정확히 두 번(열기·닫기), description은 따옴표 균형이 맞는 한 줄 문자열", async () => {
    const commands = await loadCommands();
    for (const w of renderers.gemini.render(commands, repoCtx).writes.filter((x) => x.file.endsWith(".toml"))) {
      expect(w.content.split("'''").length - 1, w.file).toBe(2);
      expect(w.content.endsWith("'''\n"), w.file).toBe(true);
      const lines = w.content.split("\n");
      const desc = lines.find((l) => l.startsWith("description = ")) ?? "";
      expect(typeof tomlString(desc, "description"), w.file).toBe("string");
      expect(lines.filter((l) => l.startsWith("prompt = ")), w.file).toEqual(["prompt = '''"]);
    }
  });

  it("Codex config 블록: [mcp_servers.dsmith] 헤더 정확히 하나, command·args가 따옴표 균형이 맞는 값", async () => {
    const commands = await loadCommands();
    for (const ctx of [repoCtx, globalCtx]) {
      const block = renderers.codex
        .render(commands, ctx)
        .writes.filter((w) => w.region.kind === "block")
        .map((w) => w.content);
      expect(block).toHaveLength(1);
      const lines = (block[0] ?? "").trimEnd().split("\n");
      expect(lines.filter((l) => l.startsWith("["))).toEqual(["[mcp_servers.dsmith]"]);
      expect(lines).toHaveLength(3);
      expect(tomlString(lines[1] ?? "", "command")).toBe("npx");
      expect(tomlString(lines[2] ?? "", "args")).toEqual(["-y", "dsmith@0.2", "mcp"]);
    }
  });

  it("실제 AGENTS.md 블록의 정확한 바이트", async () => {
    const commands = await loadCommands();
    const content = renderers["agents-md"].render(commands, repoCtx).writes[0]?.content ?? "";
    await expect(content).toMatchFileSnapshot("./__snapshots__/agents-md.real.md");
  });
});

describe("ctx.cli (로컬 빌드로 CLI 호출 치환)", () => {
  const DEV = "node /abs/dist/bin.js";
  const devCtx: RenderContext = { ...repoCtx, cli: DEV };

  it("cli를 주지 않거나 기본값(npx dsmith)이면 출력이 바이트 동일하다", async () => {
    const commands = await loadCommands();
    for (const tool of AI_TOOLS) {
      const base = renderers[tool].render(commands, repoCtx);
      expect(renderers[tool].render(commands, { ...repoCtx, cli: "npx dsmith" }), tool).toEqual(base);
      expect(renderers[tool].render(commands, { ...globalCtx, cli: "npx dsmith" }), tool).toEqual(
        renderers[tool].render(commands, globalCtx),
      );
    }
  });

  it("모든 도구의 명령 본문·AGENTS.md 블록이 npx dsmith 대신 cli를 쓴다", async () => {
    const commands = await loadCommands();
    expect(commands.some((c) => c.body.includes("npx dsmith"))).toBe(true);
    for (const tool of AI_TOOLS) {
      const writes = renderers[tool].render(commands, devCtx).writes;
      expect(writes.length, tool).toBeGreaterThan(0);
      for (const w of writes) {
        expect(w.content, `${tool} ${w.file}`).not.toContain("npx dsmith");
      }
    }
    const skill = renderers["claude-code"].render(commands, devCtx).writes.find((w) => w.file.endsWith("ds-audit/SKILL.md"));
    expect(skill?.content).toContain(`\`${DEV} audit --json $ARGUMENTS\``);
    const agents = renderers["agents-md"].render(commands, devCtx).writes[0]?.content ?? "";
    expect(agents).toContain(`\`${DEV} detect --json\``);
    expect(agents).toContain(`\`${DEV} decide --item "<이름>" --choose "<id>"\``);
    // MCP 등록은 ctx.mcp를 따른다(cli와 독립)
    expect(agents).toContain("npx -y dsmith@0.2 mcp");
  });

  it("글로벌 미지원 안내문도 cli를 쓴다", () => {
    const out = renderers.cursor.render(FIXTURES, { ...globalCtx, cli: DEV });
    expect(out.notes.join("\n")).toContain(`${DEV} install --tool cursor`);
    expect(out.notes.join("\n")).not.toContain("npx dsmith");
  });
});
