import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_TOOLS, loadCommands } from "@dsmith-dev/agent-skill";
import { formatInstallSummary, runInstall, type InstallOptions, type InstallResult } from "../src/commands/install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "../dist/bin.js");

/** 배포 전 cli 버전은 0.0.0이라 테스트는 버전을 주입한다. 0.2.x → `dsmith@0.2`. */
const VERSION = "0.2.0";

let root: string;
let home: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-install-root-")));
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-install-home-")));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const install = (opts: Partial<InstallOptions> = {}): Promise<InstallResult> =>
  runInstall({ root, home, version: VERSION, ...opts });

function write(base: string, rel: string, content: string): void {
  const abs = path.join(base, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const read = (base: string, rel: string): string => fs.readFileSync(path.join(base, rel), "utf-8");

/** 디렉터리 트리 → "경로 sha256" 줄 목록(정렬). 빈 디렉터리는 "경로/"로 포함한다. */
function tree(base: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(base, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        out.push(`${rel}/`);
        walk(abs);
      } else {
        out.push(`${rel} ${createHash("sha256").update(fs.readFileSync(abs)).digest("hex")}`);
      }
    }
  };
  walk(base);
  return out.sort();
}

const files = (base: string): string[] =>
  tree(base)
    .filter((l) => !l.endsWith("/"))
    .map((l) => l.split(" ")[0] as string);

const statuses = (r: InstallResult): string[] => [...new Set(r.outcomes.map((o) => o.status))];

const SKILLS = (prefix: string): string[] =>
  ["ds", "ds-ai", "ds-audit", "ds-check", "ds-decide", "ds-detect", "ds-guard", "ds-init", "ds-migrate"].map(
    (n) => `${prefix}/${n}/SKILL.md`,
  );

describe("runInstall: 빈 레포 기본값", () => {
  it("흔적이 없으면 claude-code + agents-md를 설치하고 산출 파일 목록이 고정이다", async () => {
    const r = await install();
    expect(r.scope).toBe("repo");
    expect(r.tools).toEqual(["claude-code", "agents-md"]);
    expect(r.detection).toMatchObject({ defaulted: true, tools: ["claude-code", "agents-md"] });
    expect(r.dryRun).toBe(false);
    expect(r.manifest).toBe(".dsmith/install.json");
    expect(statuses(r)).toEqual(["created"]);
    expect(files(root)).toEqual(
      [".dsmith/install.json", ".mcp.json", "AGENTS.md", ...SKILLS(".claude/skills")].sort(),
    );
    expect(JSON.parse(read(root, ".mcp.json"))).toEqual({
      mcpServers: { dsmith: { command: "npx", args: ["-y", "dsmith@0.2", "mcp"] } },
    });
    expect(r.mcp).toEqual({ command: "npx", args: ["-y", "dsmith@0.2", "mcp"] });
    expect(read(root, "AGENTS.md")).toContain("<!-- dsmith:start -->");
    // 홈에는 아무것도 쓰지 않는다
    expect(tree(home)).toEqual([]);
  });

  it("두 번째 실행은 전부 unchanged이고 트리(매니페스트 포함)가 바이트 동일하다", async () => {
    await install();
    const before = tree(root);
    const second = await install();
    expect(statuses(second)).toEqual(["unchanged"]);
    expect(second.outcomes).toHaveLength(11);
    expect(second.tools).toEqual(["claude-code", "agents-md"]);
    expect(tree(root)).toEqual(before);
    // 감지 결과도 같다: 1회차가 만든 파일(.claude/, CLAUDE.md 없음, AGENTS.md)이 도구 집합을 바꾸지 않는다
    expect(second.detection?.defaulted).toBe(false);
  });

  it("--dry-run은 파일시스템을 바꾸지 않고(.dsmith/ 포함) outcome에 diff를 담는다", async () => {
    const r = await install({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(tree(root)).toEqual([]);
    expect(statuses(r)).toEqual(["created"]);
    expect(r.outcomes.every((o) => typeof o.diff === "string" && o.diff.length > 0)).toBe(true);
    const text = formatInstallSummary(r);
    expect(text.split("\n")[0]).toBe("(dry-run — 아무것도 쓰지 않음)");
    expect(text).toContain("+++ .mcp.json");
  });

  it("설치된 뒤의 dry-run도 무변경이다", async () => {
    await install();
    const before = tree(root);
    const r = await install({ dryRun: true });
    expect(statuses(r)).toEqual(["unchanged"]);
    expect(tree(root)).toEqual(before);
  });
});

describe("runInstall: 사용자 수정 보존", () => {
  it("고친 SKILL.md만 skipped-modified로 남고 내용이 보존되며, --force가 덮어쓴다", async () => {
    await install();
    const skill = ".claude/skills/ds-audit/SKILL.md";
    const edited = `${read(root, skill)}\n내가 추가한 줄\n`;
    write(root, skill, edited);

    const second = await install();
    const skipped = second.outcomes.filter((o) => o.status === "skipped-modified");
    expect(skipped.map((o) => o.file)).toEqual([skill]);
    expect(second.outcomes.filter((o) => o.status === "unchanged")).toHaveLength(10);
    expect(read(root, skill)).toBe(edited);
    const text = formatInstallSummary(second);
    expect(text).toContain(`건너뜀: ${skill}`);
    expect(text).toContain("--force로 덮어쓰기");

    const forced = await install({ force: true });
    expect(forced.outcomes.filter((o) => o.status === "updated").map((o) => o.file)).toEqual([skill]);
    expect(read(root, skill)).not.toContain("내가 추가한 줄");
    // 강제 뒤에는 다시 멱등
    const before = tree(root);
    expect(statuses(await install())).toEqual(["unchanged"]);
    expect(tree(root)).toEqual(before);
  });

  it("사용자가 고친 AGENTS.md 블록도 skipped-modified, 블록 밖 내용은 항상 보존", async () => {
    write(root, "AGENTS.md", "# 우리 팀 규칙\n\n- 커밋은 작게\n");
    const first = await install({ tools: ["agents-md"] });
    expect(first.outcomes.find((o) => o.file === "AGENTS.md")?.status).toBe("created");
    const text = read(root, "AGENTS.md");
    expect(text.startsWith("# 우리 팀 규칙\n\n- 커밋은 작게\n")).toBe(true);

    const edited = text.replace("## dsmith (디자인 시스템 도구)", "## dsmith (직접 고침)");
    expect(edited).not.toBe(text);
    write(root, "AGENTS.md", edited);
    const second = await install({ tools: ["agents-md"] });
    expect(second.outcomes[0]?.status).toBe("skipped-modified");
    expect(read(root, "AGENTS.md")).toBe(edited);

    const forced = await install({ tools: ["agents-md"], force: true });
    expect(forced.outcomes[0]?.status).toBe("updated");
    expect(read(root, "AGENTS.md")).toBe(text);
  });

  it("기존 .mcp.json의 다른 서버는 보존하고 dsmith 키만 쓴다", async () => {
    write(root, ".mcp.json", JSON.stringify({ mcpServers: { other: { command: "x", args: ["y"] } } }, null, 2));
    const r = await install({ tools: ["claude-code"] });
    expect(r.outcomes.find((o) => o.file === ".mcp.json")?.status).toBe("created");
    const mcp = JSON.parse(read(root, ".mcp.json"));
    expect(mcp.mcpServers.other).toEqual({ command: "x", args: ["y"] });
    expect(mcp.mcpServers.dsmith).toEqual({ command: "npx", args: ["-y", "dsmith@0.2", "mcp"] });
  });

  it("사용자가 만든 .mcp.json의 dsmith 항목이 있으면 건너뛰고 넣을 JSON을 알려 준다", async () => {
    write(root, ".mcp.json", JSON.stringify({ mcpServers: { dsmith: { command: "mine" } } }));
    const r = await install({ tools: ["claude-code"] });
    expect(r.outcomes.find((o) => o.file === ".mcp.json")?.status).toBe("skipped-unowned");
    expect(JSON.parse(read(root, ".mcp.json")).mcpServers.dsmith).toEqual({ command: "mine" });
    const note = r.notes.find((n) => n.startsWith(".mcp.json을 건너뛰어"));
    expect(note).toBeDefined();
    const json = JSON.parse((note ?? "").split("\n").slice(1).join("\n"));
    expect(json).toEqual({ mcpServers: { dsmith: { command: "npx", args: ["-y", "dsmith@0.2", "mcp"] } } });
  });

  it("기존 AGENTS.md 본문은 블록 밖 바이트가 그대로다", async () => {
    const original = "# 팀 규칙\n\n- 한글 줄\n- 마지막 줄 (개행 없음)";
    write(root, "AGENTS.md", original);
    await install({ tools: ["agents-md"] });
    const text = read(root, "AGENTS.md");
    const start = text.indexOf("<!-- dsmith:start -->");
    expect(start).toBeGreaterThan(0);
    expect(text.slice(0, start).replace(/\r?\n+$/, "")).toBe(original.replace(/\r?\n+$/, ""));
  });
});

describe("runInstall: 도구 결정", () => {
  it("심어 둔 흔적(.cursor/ .gemini/ .agents/)으로 도구를 고르고 근거를 돌려준다", async () => {
    fs.mkdirSync(path.join(root, ".cursor"));
    fs.mkdirSync(path.join(root, ".gemini"));
    fs.mkdirSync(path.join(root, ".agents"));
    const r = await install();
    expect(r.tools).toEqual(["codex", "cursor", "gemini", "agents-md"]);
    expect(r.detection?.defaulted).toBe(false);
    expect(r.detection?.evidence).toEqual({ cursor: [".cursor/"], gemini: [".gemini/"], codex: [".agents/"] });
    const f = files(root);
    expect(f).toContain(".cursor/commands/ds.md");
    expect(f).toContain(".cursor/mcp.json");
    expect(f).toContain(".gemini/commands/ds.toml");
    expect(f).toContain(".gemini/settings.json");
    expect(f).toContain(".agents/skills/ds/SKILL.md");
    expect(f).toContain(".codex/config.toml");
    expect(f).toContain("AGENTS.md");
    expect(f).not.toContain(".mcp.json");
    expect(f).not.toContain(".claude/skills/ds/SKILL.md");

    // 첫 실행이 만든 파일(.agents/skills, .codex/, AGENTS.md…)이 감지를 바꾸지 않는다
    const before = tree(root);
    const second = await install();
    expect(second.tools).toEqual(r.tools);
    expect(statuses(second)).toEqual(["unchanged"]);
    expect(tree(root)).toEqual(before);
  });

  it("레포 흔적 하나(.cursor/)만 있어도 그 도구만 고른다", async () => {
    fs.mkdirSync(path.join(root, ".cursor"));
    const r = await install();
    expect(r.tools).toEqual(["cursor"]);
    const before = tree(root);
    expect((await install()).tools).toEqual(["cursor"]);
    expect(tree(root)).toEqual(before);
  });

  it("--all은 5개 도구 파일을 전부 만들고 Codex 신뢰 프로젝트 안내를 notes에 담는다", async () => {
    const r = await install({ all: true });
    expect(r.tools).toEqual([...AI_TOOLS]);
    expect(r.detection).toBeNull();
    const f = files(root);
    for (const expected of [
      ...SKILLS(".claude/skills"),
      ...SKILLS(".agents/skills"),
      ".mcp.json",
      ".cursor/commands/ds.md",
      ".cursor/mcp.json",
      ".gemini/commands/ds.toml",
      ".gemini/settings.json",
      ".codex/config.toml",
      "AGENTS.md",
      ".dsmith/install.json",
    ]) {
      expect(f).toContain(expected);
    }
    expect(r.notes.some((n) => n.includes("신뢰"))).toBe(true);
    expect(r.notes.some((n) => n.includes("승인"))).toBe(true);
    expect(new Set(r.notes).size).toBe(r.notes.length);
    const before = tree(root);
    expect(statuses(await install({ all: true }))).toEqual(["unchanged"]);
    expect(tree(root)).toEqual(before);
  });

  it("--all이 --tool보다 우선하고, --tool은 감지를 건너뛴다", async () => {
    fs.mkdirSync(path.join(root, ".cursor"));
    expect((await install({ tools: ["gemini"], dryRun: true })).tools).toEqual(["gemini"]);
    expect((await install({ tools: ["gemini"], all: true, dryRun: true })).tools).toEqual([...AI_TOOLS]);
  });

  it("--tool codex는 agents-md를 함께 설치하고, 중복 지정은 한 번만 쓴다", async () => {
    const r = await install({ tools: ["codex", "codex", "agents-md"], dryRun: true });
    expect(r.tools).toEqual(["codex", "agents-md"]);
  });

  it("알 수 없는 도구 이름은 에러이고 아무것도 쓰지 않는다", async () => {
    await expect(install({ tools: ["vscode" as never] })).rejects.toThrow(/vscode/);
    await expect(install({ tools: ["vscode" as never] })).rejects.toThrow(/claude-code/);
    expect(tree(root)).toEqual([]);
  });
});

describe("runInstall: --global", () => {
  it("claude-code 스킬을 홈에 쓰고 레포에는 아무것도 쓰지 않는다", async () => {
    const r = await install({ global: true, tools: ["claude-code"] });
    expect(r.scope).toBe("global");
    expect(r.manifest).toBe("~/.dsmith/install.json");
    expect(files(home)).toEqual([".dsmith/install.json", ...SKILLS(".claude/skills")].sort());
    expect(tree(root)).toEqual([]);
    expect(r.notes.some((n) => n.includes("claude mcp add --scope user"))).toBe(true);
    expect(r.outcomes[0]?.file).toBe("~/.claude/skills/ds/SKILL.md");

    const before = tree(home);
    expect(statuses(await install({ global: true, tools: ["claude-code"] }))).toEqual(["unchanged"]);
    expect(tree(home)).toEqual(before);
  });

  it("홈 흔적만 근거로 삼는다 — 레포의 .cursor/·.claude/는 무시", async () => {
    fs.mkdirSync(path.join(root, ".cursor"));
    fs.mkdirSync(path.join(root, ".claude"));
    fs.mkdirSync(path.join(home, ".codex"));
    const r = await install({ global: true });
    expect(r.tools).toEqual(["codex"]);
    expect(r.detection?.evidence).toEqual({ codex: ["~/.codex/"] });
    expect(r.detection?.defaulted).toBe(false);
    expect(files(home)).toContain(".agents/skills/ds/SKILL.md");
    expect(files(home)).toContain(".codex/config.toml");
    // 레포 쪽은 손대지 않는다
    expect(files(root)).toEqual([]);
    expect(r.notes.some((n) => n.includes("agents-md"))).toBe(false);
  });

  it("홈 흔적이 없으면 레포 흔적이 있어도 기본값(claude-code)으로 간다", async () => {
    fs.mkdirSync(path.join(root, ".cursor"));
    const r = await install({ global: true, dryRun: true });
    expect(r.tools).toEqual(["claude-code"]);
    expect(r.detection).toMatchObject({ defaulted: true, evidence: {} });
  });

  it("cursor·gemini·agents-md는 글로벌 미지원이라 파일 없이 안내만 낸다", async () => {
    const r = await install({ global: true, tools: ["cursor", "gemini", "agents-md"] });
    expect(r.outcomes).toEqual([]);
    expect(r.notes).toHaveLength(3);
    expect(r.unsupported).toEqual(["cursor", "gemini", "agents-md"]);
    const text = formatInstallSummary(r);
    expect(text).toContain("등록: cursor [미지원], gemini [미지원], agents-md [미지원] (--tool 지정)");
    expect(text.split("\n").at(-1)).toBe("다음: 이 범위에서 쓴 파일이 없습니다 — 위 할 일을 확인하세요");
    expect(tree(home)).toEqual([]);
    expect(tree(root)).toEqual([]);
  });

  it("codex가 agents-md를 끌고 오는 것은 레포 모드뿐 — 글로벌에서는 붙이지 않고, --all이면 미지원으로 표시", async () => {
    expect((await install({ global: true, tools: ["codex"], dryRun: true })).tools).toEqual(["codex"]);
    expect((await install({ tools: ["codex"], dryRun: true })).tools).toEqual(["codex", "agents-md"]);
    const all = await install({ global: true, all: true, dryRun: true });
    expect(all.tools).toEqual([...AI_TOOLS]);
    expect(all.unsupported).toEqual(["cursor", "gemini", "agents-md"]);
    const text = formatInstallSummary(all);
    expect(text).toContain("claude-code, codex, cursor [미지원], gemini [미지원], agents-md [미지원] (--all)");
  });

  it("home을 주지 않으면 HOME 환경변수의 홈을 쓴다 (os.homedir)", async () => {
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    const r = await runInstall({ root, global: true, tools: ["claude-code"], version: VERSION });
    expect(r.outcomes).toHaveLength(9);
    expect(fs.existsSync(path.join(home, ".claude", "skills", "ds", "SKILL.md"))).toBe(true);
    expect(tree(root)).toEqual([]);
  });
});

describe("runInstall: MCP 실행 명령", () => {
  it("--mcp-command는 command·args로 나눠 .mcp.json에 쓰고 커밋 경고를 낸다", async () => {
    const r = await install({ mcpCommand: "node /x/bin.js", tools: ["claude-code"] });
    expect(r.mcp).toEqual({ command: "node", args: ["/x/bin.js", "mcp"] });
    expect(JSON.parse(read(root, ".mcp.json")).mcpServers.dsmith).toEqual({ command: "node", args: ["/x/bin.js", "mcp"] });
    expect(r.notes[0]).toMatch(/^경고: /);
    expect(r.notes[0]).toContain("커밋");
  });

  it("--mcp-command는 슬래시 명령·AGENTS.md의 CLI 호출도 같은 빌드로 바꾼다 (npx dsmith 없음)", async () => {
    const r = await install({ mcpCommand: "node /x/bin.js mcp" });
    expect(r.cli).toBe("node /x/bin.js");
    expect(r.mcp).toEqual({ command: "node", args: ["/x/bin.js", "mcp"] });
    const skill = read(root, ".claude/skills/ds-audit/SKILL.md");
    expect(skill).toContain("`node /x/bin.js audit --json $ARGUMENTS`");
    for (const f of files(root).filter((f) => !f.startsWith(".dsmith/"))) {
      expect(read(root, f), f).not.toContain("npx dsmith");
    }
    const agents = read(root, "AGENTS.md");
    expect(agents).toContain("`node /x/bin.js detect --json`");
    expect(agents).toContain("`node /x/bin.js decide --item");
    expect(r.notes[0]).toContain("슬래시 명령");
    expect(r.notes[0]).toContain("node /x/bin.js");
    expect(formatInstallSummary(r)).toContain("AGENTS.md 섹션에 적힌 대로 `node /x/bin.js …` 호출");
  });

  it("--mcp-command가 없으면 기존처럼 npx dsmith 그대로(r.cli 기본값)", async () => {
    const r = await install();
    expect(r.cli).toBe("npx dsmith");
    expect(read(root, ".claude/skills/ds-audit/SKILL.md")).toContain("`npx dsmith audit --json $ARGUMENTS`");
  });

  it("글로벌 스코프에서는 커밋될 파일이 없으므로 경고하지 않는다", async () => {
    const r = await install({ mcpCommand: "node /x/bin.js", tools: ["claude-code"], global: true });
    expect(r.notes.some((n) => n.startsWith("경고:"))).toBe(false);
    expect(r.notes.some((n) => n.includes("node /x/bin.js mcp"))).toBe(true);
  });

  it("로컬 개발 빌드(0.0.0)에서는 --mcp-command가 필수이고 에러 전에 아무것도 쓰지 않는다", async () => {
    await expect(install({ version: "0.0.0" })).rejects.toThrow(/--mcp-command "node \S+bin\.js"/);
    expect(tree(root)).toEqual([]);
    const ok = await install({ version: "0.0.0", mcpCommand: "node /x/bin.js" });
    expect(ok.mcp).toEqual({ command: "node", args: ["/x/bin.js", "mcp"] });
  });

  it("빈 --mcp-command는 에러", async () => {
    await expect(install({ mcpCommand: "  " })).rejects.toThrow(/mcp-command/);
  });
});

describe("runInstall: Codex 중복 테이블 사전 점검", () => {
  const FOREIGN: Record<string, string> = {
    "표준 테이블": '[mcp_servers.dsmith]\ncommand = "mine"\nargs = []\n',
    "따옴표 테이블": '[mcp_servers."dsmith"]\ncommand = "mine"\n',
    "공백·작은따옴표 테이블": "[ mcp_servers . 'dsmith' ]\ncommand = \"mine\"\n",
    "최상위 점 키": 'model = "x"\nmcp_servers.dsmith.command = "mine"\n',
    "최상위 점 키(따옴표)": 'mcp_servers."dsmith".command = "mine"\n',
    "[mcp_servers] 안의 dsmith 키": '[mcp_servers]\ndsmith = { command = "mine" }\n',
    "[mcp_servers] 안의 점 키": '[mcp_servers]\ndsmith.command = "mine"\n',
    "테이블 배열": '[[mcp_servers.dsmith]]\ncommand = "mine"\n',
    "인라인 mcp_servers(dsmith 포함)": 'mcp_servers = { dsmith = { command = "mine" } }\n',
  };
  const REASON = "config.toml에 dsmith가 관리하지 않는 [mcp_servers.dsmith]가 있음";

  for (const scope of ["repo", "global"] as const) {
    const base = (): string => (scope === "repo" ? root : home);
    for (const [label, toml] of Object.entries(FOREIGN)) {
      it(`${scope}: ${label} → config.toml 쓰기를 건너뛰고 --force도 못 넘는다`, async () => {
        write(base(), ".codex/config.toml", toml);
        const opts: Partial<InstallOptions> = { tools: ["codex"], global: scope === "global" };
        const r = await install(opts);
        const out = r.outcomes.find((o) => o.file.endsWith(".codex/config.toml"));
        expect(out?.status).toBe("skipped-invalid");
        expect(out?.reason).toContain(REASON);
        expect(read(base(), ".codex/config.toml")).toBe(toml);
        // 나머지는 정상 설치: 스킬 9개 + (repo만) AGENTS.md 블록 — codex는 agents-md를 함께 설치한다
        expect(r.outcomes.filter((o) => o.status === "created")).toHaveLength(scope === "repo" ? 10 : 9);
        const forced = await install({ ...opts, force: true });
        expect(forced.outcomes.find((o) => o.file.endsWith(".codex/config.toml"))?.status).toBe("skipped-invalid");
        expect(read(base(), ".codex/config.toml")).toBe(toml);
        // 매니페스트에 config.toml 항목이 생기지 않는다
        const manifest = JSON.parse(read(base(), ".dsmith/install.json"));
        expect(Object.keys(manifest.entries).some((k) => k.includes("config.toml"))).toBe(false);
      });
    }
  }

  it("dsmith가 없는 인라인 mcp_servers는 쓰지 않고 테이블 안에 넣을 내용을 알려 준다", async () => {
    const toml = 'mcp_servers = { other = { command = "x" } }\n';
    write(root, ".codex/config.toml", toml);
    const r = await install({ tools: ["codex"] });
    const out = r.outcomes.find((o) => o.file === ".codex/config.toml");
    expect(out?.status).toBe("skipped-invalid");
    expect(out?.reason).toContain("인라인");
    expect(read(root, ".codex/config.toml")).toBe(toml);
    const note = r.notes.find((n) => n.includes("인라인 테이블"));
    expect(note).toContain('dsmith = { command = "npx", args = ["-y", "dsmith@0.2", "mcp"] }');
  });

  it("중복 테이블로 건너뛰면 넣을 TOML 블록을 note로 보인다", async () => {
    write(root, ".codex/config.toml", '[mcp_servers.dsmith]\ncommand = "mine"\n');
    const r = await install({ tools: ["codex"] });
    const note = r.notes.find((n) => n.startsWith(".codex/config.toml에"));
    expect(note).toContain("[mcp_servers.dsmith]\n  command = \"npx\"\n  args = [\"-y\", \"dsmith@0.2\", \"mcp\"]");
    expect(formatInstallSummary(r)).toContain("- .codex/config.toml에 dsmith가 관리하지 않는 항목이 있어");
  });

  it("[mcp_servers.dsmith.env]만 있으면 중복이 아니다 — 블록을 쓴다", async () => {
    const toml = '[mcp_servers.dsmith.env]\nFOO = "1"\n';
    write(root, ".codex/config.toml", toml);
    const r = await install({ tools: ["codex"] });
    const out = r.outcomes.find((o) => o.file === ".codex/config.toml");
    expect(out?.status).toBe("created");
    const text = read(root, ".codex/config.toml");
    expect(text).toContain("# dsmith:start");
    expect(text).toContain(toml.trim());
  });

  it("다른 테이블 안의 같은 이름 키(foo.mcp_servers.dsmith)는 중복이 아니다", async () => {
    write(root, ".codex/config.toml", '[profiles.work]\nmcp_servers.dsmith.command = "x"\n[mcp_servers.other]\ncommand = "y"\n');
    const r = await install({ tools: ["codex"] });
    expect(r.outcomes.find((o) => o.file === ".codex/config.toml")?.status).not.toBe("skipped-invalid");
  });

  it("dsmith가 쓴 마커 블록 안의 [mcp_servers.dsmith]는 중복으로 보지 않는다 (재실행 멱등)", async () => {
    write(root, ".codex/config.toml", '[mcp_servers.other]\ncommand = "y"\n');
    await install({ tools: ["codex"] });
    expect(read(root, ".codex/config.toml")).toContain("[mcp_servers.dsmith]");
    const before = tree(root);
    const second = await install({ tools: ["codex"] });
    expect(statuses(second)).toEqual(["unchanged"]);
    expect(tree(root)).toEqual(before);
  });

  it("마커 블록 밖에 따로 직접 쓴 [mcp_servers.dsmith]가 블록과 함께 있으면 건너뛴다", async () => {
    await install({ tools: ["codex"] });
    const managed = read(root, ".codex/config.toml");
    const withForeign = `${managed}\n[mcp_servers.dsmith]\ncommand = "mine"\n`;
    write(root, ".codex/config.toml", withForeign);
    const r = await install({ tools: ["codex"] });
    expect(r.outcomes.find((o) => o.file === ".codex/config.toml")?.status).toBe("skipped-invalid");
    expect(read(root, ".codex/config.toml")).toBe(withForeign);
  });

  it("건너뛴 이유가 요약에 나오되 --force 안내는 붙지 않는다", async () => {
    write(root, ".codex/config.toml", '[mcp_servers.dsmith]\ncommand = "mine"\n');
    const text = formatInstallSummary(await install({ tools: ["codex"] }));
    expect(text).toContain(`건너뜀: .codex/config.toml — ${REASON}`);
    expect(text).not.toContain("--force로 덮어쓰기");
  });
});

describe("runInstall: 매니페스트", () => {
  it("깨진 매니페스트는 비어 있는 것으로 보고 경고 note를 낸다", async () => {
    await install();
    fs.writeFileSync(path.join(root, ".dsmith", "install.json"), "{ not json");
    const r = await install();
    expect(r.notes.some((n) => n.startsWith("경고:") && n.includes(".dsmith/install.json"))).toBe(true);
    // 기록이 없으니 기존 SKILL.md는 같은 내용이면 채택(unchanged), 다른 내용이면 건너뜀 — 어느 쪽이든 예외 없음
    expect(r.outcomes.every((o) => o.status === "unchanged")).toBe(true);
    expect(() => JSON.parse(read(root, ".dsmith/install.json"))).not.toThrow();
  });
});

describe("formatInstallSummary", () => {
  it("등록 도구와 감지 근거(레포/홈), 파일 개수, 다음 단계를 보인다", async () => {
    fs.mkdirSync(path.join(root, ".claude"));
    write(root, "CLAUDE.md", "# x\n");
    fs.mkdirSync(path.join(home, ".cursor"));
    const r = await install();
    const lines = formatInstallSummary(r).split("\n");
    expect(lines[0]).toBe("등록: claude-code (레포: .claude/, CLAUDE.md), cursor (홈: ~/.cursor/)");
    expect(lines[1]).toBe("파일: 생성 20 · 변경 0 · 유지 0 · 건너뜀 0");
    expect(lines.at(-1)).toBe("다음: AI 도구를 다시 열고 /ds 로 시작");
  });

  it("기본값·강제 지정·함께 설치된 도구를 구분해 표시한다", async () => {
    expect(formatInstallSummary(await install({ dryRun: true })).split("\n")[1]).toBe(
      "등록: claude-code, agents-md (감지: 흔적 없음 → 기본값)",
    );
    expect(formatInstallSummary(await install({ dryRun: true, tools: ["codex"] }))).toContain(
      "등록: codex, agents-md (--tool 지정, agents-md는 codex와 함께)",
    );
    expect(formatInstallSummary(await install({ dryRun: true, all: true }))).toContain("(--all)");
  });

  it("다음 단계는 설치한 도구별로 나온다", async () => {
    const text = formatInstallSummary(await install());
    expect(text).toContain(
      "다음: AI 도구를 다시 열고\n- claude-code: /ds 로 시작\n- agents-md: AGENTS.md 섹션에 적힌 대로 `npx dsmith …` 호출",
    );
    expect(formatInstallSummary(await install({ dryRun: true, tools: ["agents-md"] }))).toContain("다음: --dry-run");
    const agentsOnly = formatInstallSummary(await install({ tools: ["agents-md"] }));
    expect(agentsOnly.split("\n").at(-1)).toBe("다음: AGENTS.md 섹션에 적힌 대로 `npx dsmith …` 호출");
    const codex = formatInstallSummary(await install({ tools: ["codex"] }));
    expect(codex).toContain("- codex: $ds 로 시작 (또는 /skills 에서 ds 선택)");
    const mixed = formatInstallSummary(await install({ tools: ["claude-code", "cursor", "gemini"] }));
    expect(mixed.split("\n").at(-1)).toBe("다음: AI 도구를 다시 열고 /ds 로 시작");
  });

  it("notes는 중복 없이 '할 일:' 아래 한 줄씩 나온다", () => {
    const r: InstallResult = {
      scope: "repo",
      tools: ["claude-code"],
      unsupported: [],
      cli: "npx dsmith",
      selection: "tool",
      detection: null,
      mcp: { command: "npx", args: ["-y", "dsmith@0.2", "mcp"] },
      outcomes: [],
      notes: ["a", "b", "a"],
      manifest: ".dsmith/install.json",
      dryRun: false,
    };
    const text = formatInstallSummary(r);
    expect(text).toContain("할 일:\n- a\n- b\n");
    expect(text.match(/- a/g)).toHaveLength(1);
  });
});

describe("dsmith install (CLI)", () => {
  const run = (args: string[], env: Record<string, string> = {}): string =>
    execFileSync(process.execPath, [bin, "install", "--root", root, "--mcp-command", "node /x/bin.js", ...args], {
      encoding: "utf-8",
      env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
    });

  it("--json은 InstallResult 그대로, --tool 반복·변수 인자 모두 받는다", () => {
    const out = JSON.parse(run(["--json", "--tool", "cursor", "--tool", "gemini", "--dry-run"]));
    expect(out.tools).toEqual(["cursor", "gemini"]);
    expect(out.dryRun).toBe(true);
    expect(out.detection).toBeNull();
    expect(out.mcp).toEqual({ command: "node", args: ["/x/bin.js", "mcp"] });
    expect(tree(root)).toEqual([]);
    const out2 = JSON.parse(run(["--json", "--tool", "cursor", "gemini", "--dry-run"]));
    expect(out2.tools).toEqual(["cursor", "gemini"]);
  });

  it("사람용 요약을 stdout에 쓰고, 두 번째 실행은 유지만 센다", () => {
    const first = run([]);
    expect(first).toContain("등록: claude-code, agents-md (감지: 흔적 없음 → 기본값)");
    expect(first).toContain("파일: 생성 11 · 변경 0 · 유지 0 · 건너뜀 0");
    const second = run([]);
    expect(second).toContain("파일: 생성 0 · 변경 0 · 유지 11 · 건너뜀 0");
  });

  it("--global은 HOME 환경변수의 홈에 쓴다", () => {
    run(["--global", "--tool", "claude-code"]);
    expect(fs.existsSync(path.join(home, ".claude", "skills", "ds", "SKILL.md"))).toBe(true);
    expect(tree(root)).toEqual([]);
  });

  it("알 수 없는 --tool은 stderr 오류와 종료 코드 1", () => {
    let err: { status?: number; stderr?: string } = {};
    try {
      run(["--tool", "vscode"]);
    } catch (e) {
      err = e as typeof err;
    }
    expect(err.status).toBe(1);
    expect(err.stderr).toContain("vscode");
    expect(tree(root)).toEqual([]);
  });

  it("--mcp-command 없이는 0.0.0 개발 빌드에서 실패한다(배포판에서는 건너뜀)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, "../package.json"), "utf-8")) as { version: string };
    if (pkg.version !== "0.0.0") return;
    let status: number | undefined;
    try {
      execFileSync(process.execPath, [bin, "install", "--root", root, "--dry-run"], { encoding: "utf-8", stdio: "pipe" });
    } catch (e) {
      status = (e as { status?: number }).status;
    }
    expect(status).toBe(1);
  });
});

describe("명령 소스 로드", () => {
  it("설치되는 SKILL.md 개수는 명령 소스 개수와 같다", async () => {
    const commands = await loadCommands();
    const r = await install({ tools: ["claude-code"], dryRun: true });
    expect(r.outcomes.filter((o) => o.file.endsWith("SKILL.md"))).toHaveLength(commands.length);
  });
});

describe("install: 스킬이 전부 건너뛰어진 경우 · dry-run 건너뜀 예정 · 개발 빌드 안내", () => {
  const skillFiles = [...SKILLS(".claude/skills")];

  async function editAllSkills(): Promise<void> {
    await install({ tools: ["claude-code"] });
    for (const f of skillFiles) write(root, f, `${read(root, f)}\n고침\n`);
  }

  it("모든 SKILL.md가 skipped-modified면 allSkillsSkipped이고 다음 단계는 사유를 해결하라는 안내다(/ds 안내 없음)", async () => {
    await editAllSkills();
    const r = await install({ tools: ["claude-code"] });
    expect(r.allSkillsSkipped).toBe(true);
    const text = formatInstallSummary(r);
    expect(text.split("\n").at(-1)).toBe("다음: 건너뜀 사유를 해결한 뒤 다시 실행");
    expect(text).not.toContain("/ds 로 시작");
  });

  it("일부만 건너뛰면 평소처럼 /ds 안내이고 allSkillsSkipped가 없다", async () => {
    await install({ tools: ["claude-code"] });
    write(root, skillFiles[0] as string, `${read(root, skillFiles[0] as string)}\n고침\n`);
    const r = await install({ tools: ["claude-code"] });
    expect(r).not.toHaveProperty("allSkillsSkipped");
    expect(formatInstallSummary(r)).toContain("/ds 로 시작");
  });

  it("MCP 설정만 건너뛰어도 스킬은 쓰였으니 allSkillsSkipped가 아니다", async () => {
    write(root, ".mcp.json", JSON.stringify({ mcpServers: { dsmith: { command: "mine" } } }));
    const r = await install({ tools: ["claude-code"] });
    expect(r.outcomes.some((o) => o.status.startsWith("skipped"))).toBe(true);
    expect(r).not.toHaveProperty("allSkillsSkipped");
  });

  it("dry-run에서는 allSkillsSkipped를 세우지 않고, 건너뛸 영역은 diff 대신 '(건너뜀 예정: 사유)'를 보인다", async () => {
    await editAllSkills();
    const r = await install({ tools: ["claude-code"], dryRun: true });
    expect(r).not.toHaveProperty("allSkillsSkipped");
    const text = formatInstallSummary(r);
    expect(text).toContain("(건너뜀 예정: ");
    expect(text).not.toContain("+++ .claude/skills/ds-audit/SKILL.md");
    expect(text.match(/\(건너뜀 예정: /g)).toHaveLength(skillFiles.length);
  });

  it("CLI: 스킬이 전부 건너뛰어지면 종료 코드 1, dry-run은 0", async () => {
    await editAllSkills();
    const args = ["install", "--root", root, "--mcp-command", "node /x/bin.js", "--tool", "claude-code"];
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    expect(() => execFileSync(process.execPath, [bin, ...args], { encoding: "utf-8", env, stdio: "pipe" })).toThrow(
      expect.objectContaining({ status: 1 }),
    );
    expect(() => execFileSync(process.execPath, [bin, ...args, "--dry-run"], { encoding: "utf-8", env, stdio: "pipe" })).not.toThrow();
  });

  it("--global의 cursor·gemini 안내는 0.0.0 빌드일 때만 --mcp-command를 되풀이한다", async () => {
    const dev = await install({ global: true, tools: ["cursor", "gemini"], version: "0.0.0", mcpCommand: "node /x/bin.js" });
    for (const tool of ["cursor", "gemini"]) {
      expect(dev.notes.join("\n")).toContain(`\`node /x/bin.js install --tool ${tool} --mcp-command "node /x/bin.js"\``);
    }
    const released = await install({ global: true, tools: ["cursor", "gemini"] });
    expect(released.notes.join("\n")).toContain("`npx dsmith install --tool cursor`");
    expect(released.notes.join("\n")).not.toContain("--mcp-command");
  });
});
