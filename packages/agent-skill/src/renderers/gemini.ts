/**
 * Gemini CLI 렌더러. 규약 확인: 2026-11-01 (부록 A.5)
 * - 명령: 프로젝트 `<root>/.gemini/commands/`, 이름 = commands 기준 상대 경로(하위 디렉터리는 `:` 네임스페이스),
 *   TOML, `prompt`(필수 문자열)·`description`(선택). `{{args}}`는 입력으로 치환되고 없으면 입력이 뒤에 붙는다.
 *   `!{…}`는 셸 주입, `@{…}`는 파일 주입이라 본문에 있으면 렌더 에러로 막는다.
 *   https://geminicli.com/docs/cli/custom-commands/
 * - MCP: 프로젝트 `.gemini/settings.json`, 사용자 `~/.gemini/settings.json`, `mcpServers` → `{ command, args, ... }`.
 *   도구 이름은 `mcp_{serverName}_{toolName}`이라 서버 이름에 밑줄을 쓰지 않는다(`dsmith`).
 *   https://geminicli.com/docs/tools/mcp-server/
 * 규약이 바뀌면 이 파일만 고친다.
 */
import path from "node:path";
import type { PlannedWrite } from "@dsmith-dev/core";
import type { CommandSource } from "../commands.js";
import {
  MANAGED_NOTICE,
  mcpJsonWrite,
  mcpServerEntry,
  unsupportedGlobal,
  withCli,
  type RenderContext,
  type Renderer,
  type RenderOutput,
} from "./shared.js";

function commandToml(c: CommandSource): string {
  if (c.body.includes("'''")) {
    throw new Error(`gemini 렌더 실패: ${c.name} 본문에 TOML 여러 줄 문자열 구분자(''')가 있음`);
  }
  if (c.body.includes("!{") || c.body.includes("@{")) {
    throw new Error(`gemini 렌더 실패: ${c.name} 본문에 셸·파일 주입 구문(!{ 또는 @{)이 있음`);
  }
  // JSON 문자열 이스케이프는 TOML 기본 문자열에서도 유효하다.
  return `# ${MANAGED_NOTICE}\ndescription = ${JSON.stringify(c.description)}\nprompt = '''\n${c.body}\n'''\n`;
}

export const geminiRenderer: Renderer = {
  tool: "gemini",
  verified: {
    date: "2026-11-01",
    urls: ["https://geminicli.com/docs/cli/custom-commands/", "https://geminicli.com/docs/tools/mcp-server/"],
  },
  supportsGlobal: false,
  render(commands: CommandSource[], ctx: RenderContext): RenderOutput {
    if (ctx.scope === "global") {
      return unsupportedGlobal("gemini", ctx);
    }
    const writes: PlannedWrite[] = withCli(commands, ctx.cli).map((c) => ({
      file: path.join(ctx.root, ".gemini", "commands", `${c.name}.toml`),
      region: { kind: "file" },
      content: commandToml(c),
    }));
    writes.push(mcpJsonWrite(path.join(ctx.root, ".gemini", "settings.json"), mcpServerEntry(ctx.mcp)));
    return { writes, notes: [] };
  },
};
