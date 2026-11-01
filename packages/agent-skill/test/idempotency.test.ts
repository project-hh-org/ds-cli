import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeWrite, type PlannedWrite, type WriteOutcome } from "@dsmith-dev/core";
import { afterEach, describe, expect, it } from "vitest";
import { loadCommands } from "../src/commands.js";
import { detectTools, normalizeTools } from "../src/detect-tools.js";
import { renderers } from "../src/index.js";
import { defaultMcpLaunch } from "../src/mcp-launch.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** install이 하는 일의 축소판: 감지 → 렌더 → 실제 core safeWrite. */
async function installOnce(root: string, home: string): Promise<{ tools: string[]; outcomes: WriteOutcome[] }> {
  const commands = await loadCommands();
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
    expect(first.outcomes.length).toBe(10); // 스킬 8 + .mcp.json + AGENTS.md
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
