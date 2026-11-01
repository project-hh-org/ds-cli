import fs from "node:fs";
import path from "node:path";
import { runInit } from "@dsmith-dev/init";
import { describe, expect, it } from "vitest";
import { runAi, formatAiSummary, findInitDir } from "../src/index.js";
import { copyExample, copyFixture, forceStateZero, installMui, overlay, treeHash, writeAudit } from "./helpers.js";

const VERSION = "0.0.0-test";
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf-8");
const START = "<!-- dsmith:ds:start -->";
const END = "<!-- dsmith:ds:end -->";

async function withDsApp(extra: Record<string, string> = {}): Promise<string> {
  const root = fs.realpathSync(copyFixture("with-ds-app", { ...overlay, ...extra }));
  await writeAudit(root);
  return root;
}

describe("runAi: with-ds-app", () => {
  it("1회: DS 블록·catalog.json·ai.json 생성, 2회: 변화 없음", async () => {
    const root = await withDsApp();
    const first = await runAi({ root, version: VERSION });
    expect(first.outcomes.map((o) => o.status)).toEqual(["created"]);
    expect(first.catalogChanged).toBe(true);
    expect(first.catalogFile).toBe(".dsmith/catalog.json");
    expect(first.components).toBe(3);
    expect(first.propsExtracted).toEqual({ ok: 2, total: 3, rate: 0.6667 });
    expect(first.deprecated).toBe(1);
    const agents = read(root, "AGENTS.md");
    expect(agents).toContain(START);
    expect(agents).toContain(END);
    expect(agents.split("\n").length).toBeLessThanOrEqual(80 + 2);
    expect(fs.existsSync(path.join(root, ".dsmith", "catalog.json"))).toBe(true);
    expect(JSON.parse(read(root, ".dsmith/ai.json")).tool).toBe("ai");

    const before = treeHash(root);
    const catalogMtime = fs.statSync(path.join(root, ".dsmith", "catalog.json")).mtimeMs;
    const second = await runAi({ root, version: VERSION });
    expect(second.outcomes.map((o) => o.status)).toEqual(["unchanged"]);
    expect(second.catalogChanged).toBe(false);
    expect(treeHash(root)).toEqual(before);
    expect(fs.statSync(path.join(root, ".dsmith", "catalog.json")).mtimeMs).toBe(catalogMtime);
  });

  it("생성된 DS 섹션 — 사용 수 순으로 Button이 앞", async () => {
    const root = await withDsApp();
    await runAi({ root, version: VERSION });
    const agents = read(root, "AGENTS.md");
    const section = agents.slice(agents.indexOf(START), agents.indexOf(END) + END.length);
    expect(section).toMatchSnapshot();
  });

  it("install의 AGENTS.md 블록과 공존 — 서로의 블록을 건드리지 않는다", async () => {
    const root = await withDsApp();
    const installBlock = "<!-- dsmith:start -->\ninstall이 쓴 내용\n<!-- dsmith:end -->";
    const user = "# 우리 레포\n\n사용자 본문\n\n";
    fs.writeFileSync(path.join(root, "AGENTS.md"), `${user}${installBlock}\n`);
    fs.mkdirSync(path.join(root, ".dsmith"), { recursive: true });
    const installJson = '{"version":1,"tool":"install","dsmith":"0.2.0","entries":{}}\n';
    fs.writeFileSync(path.join(root, ".dsmith", "install.json"), installJson);

    await runAi({ root, version: VERSION });
    const agents = read(root, "AGENTS.md");
    expect(agents).toContain(START);
    expect(agents.startsWith(`${user}${installBlock}\n`)).toBe(true);
    expect(read(root, ".dsmith/install.json")).toBe(installJson);

    // 두 번째 ai 실행도 install 블록·본문 보존
    await runAi({ root, version: VERSION });
    expect(read(root, "AGENTS.md")).toBe(agents);
  });

  it("사용자가 DS 블록을 고치면 skipped-modified, --force면 updated", async () => {
    const root = await withDsApp();
    await runAi({ root, version: VERSION });
    const edited = read(root, "AGENTS.md").replace("### 규칙", "### 규칙 (내가 고침)");
    fs.writeFileSync(path.join(root, "AGENTS.md"), edited);

    const skipped = await runAi({ root, version: VERSION });
    expect(skipped.outcomes[0]?.status).toBe("skipped-modified");
    expect(read(root, "AGENTS.md")).toBe(edited);
    expect(formatAiSummary(skipped)).toContain("건너뜀");

    const forced = await runAi({ root, version: VERSION, force: true });
    expect(forced.outcomes[0]?.status).toBe("updated");
    expect(read(root, "AGENTS.md")).not.toContain("내가 고침");
  });

  it("--dry-run: .dsmith 포함 트리가 그대로, diff에 시작 마커", async () => {
    const root = await withDsApp();
    const before = treeHash(root);
    const r = await runAi({ root, version: VERSION, dryRun: true });
    expect(treeHash(root)).toEqual(before);
    expect(r.dryRun).toBe(true);
    expect(r.catalogFile).toBeNull();
    expect(r.catalogChanged).toBe(true);
    expect(r.outcomes[0]?.diff).toContain(START);
    expect(formatAiSummary(r)).toContain("dry-run");
  });

  it("CLAUDE.md가 있으면 @AGENTS.md 안내, 이미 있으면 안내 없음; install.json 없으면 MCP 안내", async () => {
    const root = await withDsApp({ "CLAUDE.md": "# x\n" });
    const r = await runAi({ root, version: VERSION });
    expect(r.notes.some((n) => n.includes("@AGENTS.md"))).toBe(true);
    expect(r.notes.some((n) => n.includes("npx dsmith install"))).toBe(true);
    expect(read(root, "CLAUDE.md")).toBe("# x\n");

    fs.writeFileSync(path.join(root, "CLAUDE.md"), "# x\n@AGENTS.md\n");
    fs.writeFileSync(path.join(root, ".dsmith", "install.json"), '{"version":1,"tool":"install","dsmith":"0","entries":{}}\n');
    const r2 = await runAi({ root, version: VERSION });
    expect(r2.notes).toEqual([]);
  });

  it("CLAUDE.md가 없으면 안내 없음", async () => {
    const root = await withDsApp();
    const r = await runAi({ root, version: VERSION });
    expect(r.notes.some((n) => n.includes("CLAUDE.md"))).toBe(false);
  });

  it("audit 결과가 없으면 Error", async () => {
    const root = fs.realpathSync(copyFixture("with-ds-app", overlay));
    await expect(runAi({ root, version: VERSION })).rejects.toThrow("dsmith audit");
  });
});

describe("runAi: npm DS (fixtures/mui-app)", () => {
  it("MUI 6 발췌 → Button props가 카탈로그에 들어가고 DS 위치에 패키지@버전", async () => {
    const root = fs.realpathSync(copyFixture("mui-app"));
    installMui(root, "mui-material-6");
    await writeAudit(root);
    const r = await runAi({ root, version: VERSION });
    expect(r.sources[0]?.origin).toBe("ds-npm");
    const catalog = JSON.parse(read(root, ".dsmith/catalog.json"));
    const button = catalog.components.find((c: { name: string }) => c.name === "Button");
    expect(button.props.find((p: { name: string }) => p.name === "variant")?.values).toContain("contained");
    expect(read(root, "AGENTS.md")).toContain("@mui/material@6.5.0");
  });
});

describe("runAi: 상태 0 (examples/legacy-demo) → init → ai", () => {
  it("init 산출 기준 카탈로그: 컴포넌트·토큰 수가 init 결과와 같다", async () => {
    const root = copyExample("legacy-demo");
    await forceStateZero(root);
    const init = await runInit({ root, all: true, version: VERSION });
    const r = await runAi({ root, version: VERSION });
    expect(r.sources).toEqual([
      { origin: "init", dir: "design-system/components", tokenFiles: [{ file: "design-system/tokens.json", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }] },
    ]);
    expect(init.scaffolds.length).toBeGreaterThan(0);
    expect(r.components).toBe(init.scaffolds.length);
    expect(r.tokens).toBe(init.tokens.total);
    expect(read(root, "AGENTS.md")).toContain("design-system/");
  });

  it("ds none + init 산출 없음 → Error", async () => {
    const root = copyExample("legacy-demo");
    await forceStateZero(root);
    await expect(runAi({ root, version: VERSION })).rejects.toThrow("DS를 찾지 못함");
  });
});

describe("runAi: 보강 (fix round 1)", () => {
  it("init 산출 컴포넌트도 이름 기준 사용 수로 정렬한다(module 조인이 0일 때)", async () => {
    const root = copyExample("legacy-demo");
    await forceStateZero(root);
    await runInit({ root, all: true, version: VERSION });
    // 골격(손대지 않은 init 산출)은 컴포넌트 줄에 오르지 않으므로 구현한 것처럼 고쳐 둔다
    const dir = path.join(root, "design-system", "components");
    for (const f of fs.readdirSync(dir)) fs.appendFileSync(path.join(dir, f), "// 구현함\n");
    await runAi({ root, version: VERSION });
    const agents = read(root, "AGENTS.md");
    const line = agents.split("\n").find((l) => l.startsWith("- 컴포넌트")) ?? "";
    // 인덱스 사용 수는 Button(6) > Badge(…)이고 사전순은 Badge < Button이다 — 사용 수가 반영돼야 Button이 앞
    expect(line.indexOf("Button")).toBeGreaterThan(-1);
    expect(line.indexOf("Button")).toBeLessThan(line.indexOf("Badge"));
  });

  it("init 섹션은 tokens.css(CSS 변수)를 함께 안내한다", async () => {
    const root = copyExample("legacy-demo");
    await forceStateZero(root);
    await runInit({ root, all: true, version: VERSION });
    await runAi({ root, version: VERSION });
    const agents = read(root, "AGENTS.md");
    expect(agents).toContain("`design-system/tokens.json`");
    expect(agents).toContain("CSS 변수: `design-system/tokens.css`");
  });

  it("npm DS 섹션에는 '토큰 파일: 없음 — init' 문구가 없다", async () => {
    const root = fs.realpathSync(copyFixture("mui-app"));
    installMui(root, "mui-material-6");
    await writeAudit(root);
    await runAi({ root, version: VERSION });
    expect(read(root, "AGENTS.md")).not.toContain("dsmith init");
  });

  it("MCP 안내: .mcp.json·.cursor/mcp.json·.gemini/settings.json·.codex/config.toml의 dsmith 항목도 등록으로 본다", async () => {
    const cases: Record<string, string> = {
      ".mcp.json": '{"mcpServers":{"dsmith":{"command":"npx"}}}',
      ".cursor/mcp.json": '{"mcpServers":{"dsmith":{"command":"npx"}}}',
      ".gemini/settings.json": '{"mcpServers":{"dsmith":{"command":"npx"}}}',
      ".codex/config.toml": '[mcp_servers.dsmith]\ncommand = "npx"\n',
    };
    for (const [file, content] of Object.entries(cases)) {
      const root = await withDsApp({ [file]: content });
      const r = await runAi({ root, version: VERSION });
      expect(r.notes.some((n) => n.includes("MCP 서버 미등록")), file).toBe(false);
    }
    const none = await withDsApp({ ".mcp.json": '{"mcpServers":{"other":{}}}' });
    expect((await runAi({ root: none, version: VERSION })).notes.some((n) => n.includes("MCP 서버 미등록"))).toBe(true);
  });

  it("--from init인데 init 컴포넌트가 없으면 기존 DS 섹션·카탈로그를 덮어쓰지 않고 안내한다", async () => {
    const root = await withDsApp();
    await runAi({ root, version: VERSION });
    const agents = read(root, "AGENTS.md");
    const catalog = read(root, ".dsmith/catalog.json");
    fs.mkdirSync(path.join(root, "design-system", "components"), { recursive: true });
    fs.writeFileSync(path.join(root, "design-system", "tokens.json"), "{}\n");
    const r = await runAi({ root, version: VERSION, from: "init" });
    expect(r.outcomes).toEqual([]);
    expect(r.catalogFile).toBeNull();
    expect(r.warnings.join("\n")).toContain("init 컴포넌트가 없음");
    expect(r.notes.join("\n")).toContain("dsmith init");
    expect(read(root, "AGENTS.md")).toBe(agents);
    expect(read(root, ".dsmith/catalog.json")).toBe(catalog);
  });

  it("상대 root도 절대 경로로 풀어 쓴다", async () => {
    const root = await withDsApp();
    const rel = path.relative(process.cwd(), root);
    const r = await runAi({ root: rel, version: VERSION });
    expect(r.outcomes[0]?.status).toBe("created");
  });

  it("findInitDir: init.json의 outDir(최근 산출)을 엔트리 키보다 우선한다", async () => {
    const root = copyExample("legacy-demo");
    await forceStateZero(root);
    await runInit({ root, all: true, version: VERSION });
    await runInit({ root, all: true, outDir: "src/ds", version: VERSION, now: new Date(2026, 10, 3) });
    // 엔트리 키 이름순으로는 design-system이 앞이지만 최근 산출은 src/ds
    expect(await findInitDir(root)).toBe("src/ds");
    const r = await runAi({ root, version: VERSION });
    expect(r.sources).toMatchObject([{ origin: "init", dir: "src/ds/components" }]);
  });
});

describe("runAi: 골격 표시", () => {
  it("init 산출 중 init.json 해시와 같은 파일은 status scaffold, 고친 파일은 실제 구현으로 본다", async () => {
    const root = copyExample("legacy-demo");
    await forceStateZero(root);
    const init = await runInit({ root, all: true, version: VERSION });
    const [edited, ...rest] = init.scaffolds;
    if (edited === undefined) throw new Error("scaffold 없음");
    fs.appendFileSync(path.join(root, edited.file), "// 구현함\n");
    await runAi({ root, version: VERSION });
    const catalog = JSON.parse(read(root, ".dsmith/catalog.json")) as { components: { name: string; status?: string }[] };
    expect(catalog.components.find((c) => c.name === edited.name)?.status).toBeUndefined();
    expect(rest.length).toBeGreaterThan(0);
    for (const s of rest) expect(catalog.components.find((c) => c.name === s.name)?.status, s.name).toBe("scaffold");
    const agents = read(root, "AGENTS.md");
    expect(agents).toContain("- 골격(구현 전) — 새 UI에 쓰지 말 것:");
    const scaffoldLine = agents.split("\n").find((l) => l.startsWith("- 골격")) ?? "";
    expect(scaffoldLine).not.toContain(edited.name);
    for (const s of rest) expect(scaffoldLine).toContain(s.name);
  });

  it("읽은 토큰 파일의 sha256을 소스에 기록한다", async () => {
    const root = copyExample("legacy-demo");
    await forceStateZero(root);
    await runInit({ root, all: true, version: VERSION });
    await runAi({ root, version: VERSION });
    const catalog = JSON.parse(read(root, ".dsmith/catalog.json")) as { sources: { tokenFiles?: { file: string; sha256: string }[] }[] };
    const files = catalog.sources.flatMap((s) => s.tokenFiles ?? []);
    expect(files.map((f) => f.file)).toEqual(["design-system/tokens.json"]);
    const { createHash } = await import("node:crypto");
    expect(files[0]?.sha256).toBe(createHash("sha256").update(fs.readFileSync(path.join(root, "design-system/tokens.json"))).digest("hex"));
  });
});
