import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// 명령 본문에 TOML 여러 줄 구분자(''')를 심어 Gemini 렌더러만 실패하게 만든다.
vi.mock("@dsmith-dev/agent-skill", async (importOriginal) => {
  const original = await importOriginal<typeof import("@dsmith-dev/agent-skill")>();
  return {
    ...original,
    loadCommands: async () => [
      { name: "ds", description: "테스트 명령", uses: [], body: "본문 ''' 구분자" },
    ],
  };
});

const { runInstall } = await import("../src/commands/install.js");

let root: string;
let home: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-abort-root-")));
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-abort-home-")));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

it("렌더러 하나가 실패하면 다른 도구 파일도 쓰기 전에 전체가 중단된다 (매니페스트 포함 무변경)", async () => {
  await expect(
    runInstall({ root, home, version: "0.2.0", tools: ["claude-code", "cursor", "gemini"] }),
  ).rejects.toThrow(/gemini 렌더 실패/);
  expect(fs.readdirSync(root)).toEqual([]);
  expect(fs.readdirSync(home)).toEqual([]);
});
