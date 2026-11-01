import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeWrite, type PlannedWrite, type WriteOutcome } from "@dsmith-dev/core";
import { afterEach, describe, expect, it } from "vitest";
import { loadCommands, type CommandSource } from "../src/commands.js";
import { detectTools, normalizeTools } from "../src/detect-tools.js";
import { renderers } from "../src/index.js";
import { defaultMcpLaunch } from "../src/mcp-launch.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** install이 하는 일의 축소판: 감지 → 렌더 → 실제 core safeWrite. */
async function installOnce(
  root: string,
  home: string,
  override: (commands: CommandSource[]) => CommandSource[] = (c) => c,
): Promise<{ tools: string[]; outcomes: WriteOutcome[] }> {
  const commands = override(await loadCommands());
  const detection = await detectTools(root, home);
  const mcp = defaultMcpLaunch("0.2.0");
  const writes: PlannedWrite[] = [];
  for (const tool of normalizeTools(detection.tools)) {
    writes.push(...renderers[tool].render(commands, { root, home, scope: "repo", mcp }).writes);
  }
  const result = await safeWrite(writes, {
    manifestFile: path.join(root, ".dsmith", "install.json"),
    displayRoot: root,
    confineTo: root,
    home,
    tool: "install",
    version: "0.2.0",
  });
  return { tools: detection.tools, outcomes: result.outcomes };
}

describe("기본 설치 멱등성 (빈 레포, 도구 흔적 없음)", () => {
  it("두 번째 실행은 감지 결과가 같고 모든 영역이 unchanged, 파일 바이트도 같다", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-idem-"));
    tmpDirs.push(base);
    const root = path.join(base, "repo");
    const home = path.join(base, "home");
    fs.mkdirSync(root);
    fs.mkdirSync(home);

    const first = await installOnce(root, home);
    expect(first.tools).toEqual(["claude-code", "agents-md"]);
    expect(first.outcomes.length).toBe(11); // 스킬 9 + .mcp.json + AGENTS.md
    expect(first.outcomes.every((o) => o.status === "created")).toBe(true);

    const snapshot = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else out[path.relative(root, p)] = fs.readFileSync(p, "utf-8");
        }
      };
      walk(root);
      return out;
    };
    const after1 = snapshot();

    const second = await installOnce(root, home);
    expect(second.tools).toEqual(first.tools);
    expect(second.outcomes.map((o) => o.status)).toEqual(second.outcomes.map(() => "unchanged"));
    expect(second.outcomes.length).toBe(first.outcomes.length);
    expect(snapshot()).toEqual(after1);
  });
});

/** 3a가 설치한 stub 본문 — 재설치로 새 본문으로 바뀌어야 한다 */
const STUBS: Record<string, string> = {
  "ds-init": "`/ds-init`은 아직 제공되지 않음. 다음 릴리스에서 이 명령의 본문이 교체된다. 파일을 만들거나 고치지 않고 이 안내만 전한다.",
  "ds-ai": "`/ds-ai`는 아직 제공되지 않음. 다음 릴리스에서 이 명령의 본문이 교체된다. 파일을 만들거나 고치지 않고 이 안내만 전한다.",
};

describe("stub → 실제 본문 교체 (재설치)", () => {
  it("3a stub으로 설치한 레포에 새 본문으로 다시 설치하면 ds-init·ds-ai SKILL.md(와 AGENTS.md 명령 표)만 updated", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-idem-stub-"));
    tmpDirs.push(base);
    const root = path.join(base, "repo");
    const home = path.join(base, "home");
    fs.mkdirSync(root);
    fs.mkdirSync(home);

    const asStub = (commands: CommandSource[]): CommandSource[] =>
      commands.map((c) => (c.name in STUBS ? { ...c, uses: [], body: STUBS[c.name] as string } : c));
    const first = await installOnce(root, home, asStub);
    expect(first.outcomes.every((o) => o.status === "created")).toBe(true);
    const skill = (name: string): string => fs.readFileSync(path.join(root, ".claude", "skills", name, "SKILL.md"), "utf-8");
    expect(skill("ds-init")).toContain("아직 제공되지 않음");

    const second = await installOnce(root, home);
    // AGENTS.md 블록의 명령 표가 "아직 없음" → 실제 uses로 바뀌므로 그 영역도 updated다.
    const updated = second.outcomes.filter((o) => o.status === "updated").map((o) => (o.file.endsWith("SKILL.md") ? path.basename(path.dirname(o.file)) : path.basename(o.file)));
    expect(updated.sort()).toEqual(["AGENTS.md", "ds-ai", "ds-init"]);
    expect(second.outcomes.filter((o) => o.status !== "updated").every((o) => o.status === "unchanged")).toBe(true);
    expect(skill("ds-init")).toContain("npx dsmith init --dry-run --json");
    expect(skill("ds-ai")).toContain("npx dsmith ai --dry-run --json");

    const third = await installOnce(root, home);
    expect(third.outcomes.every((o) => o.status === "unchanged")).toBe(true);
  });

  it("stub을 사람이 고쳤으면 skipped-modified로 남긴다", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-idem-stub2-"));
    tmpDirs.push(base);
    const root = path.join(base, "repo");
    const home = path.join(base, "home");
    fs.mkdirSync(root);
    fs.mkdirSync(home);
    await installOnce(root, home, (cs) => cs.map((c) => (c.name in STUBS ? { ...c, uses: [], body: STUBS[c.name] as string } : c)));
    const file = path.join(root, ".claude", "skills", "ds-init", "SKILL.md");
    fs.appendFileSync(file, "\n사람이 덧붙인 줄\n");
    const second = await installOnce(root, home);
    const init = second.outcomes.find((o) => o.file.includes(path.join("ds-init", "SKILL.md")));
    expect(init?.status).toBe("skipped-modified");
    expect(fs.readFileSync(file, "utf-8")).toContain("사람이 덧붙인 줄");
  });
});
