/**
 * Cursor 렌더러. 규약 부분 확인: 2026-11-01 (부록 A.4)
 * - 명령: `.cursor/commands/` 디렉터리의 일반 마크다운 파일(frontmatter 언급 없음).
 *   https://docs.cursor.com/en/agent/chat/commands
 *   미확인: 명령 이름 = 파일명(문서 예시 `review-code.md`에서 추론), 인자 처리, 글로벌 `~/.cursor/commands`.
 *   폴백: 파일명 = 명령 이름으로 렌더, 인자는 본문 문장("명령 뒤에 적은 내용")으로 처리, 글로벌은 미지원 note.
 *   Cursor가 명령을 스킬로 옮기는 중일 수 있다(https://cursor.com/docs/context/commands 의 `/migrate-to-skills`).
 * - MCP: 프로젝트 `.cursor/mcp.json`, 최상위 `mcpServers`, `command`(필수)·`args`·`env`.
 *   stdio 표에 `type: "stdio"`가 있으나 예시는 생략 → 우리는 `type: "stdio"`를 넣는다.
 *   https://cursor.com/docs/context/mcp
 * 규약이 바뀌면 이 파일만 고친다.
 */
import path from "node:path";
import type { PlannedWrite } from "@dsmith-dev/core";
import type { CommandSource } from "../commands.js";
import {
  MANAGED_NOTICE,
  mcpJsonWrite,
  mcpServerEntry,
  substituteArgs,
  unsupportedGlobal,
  type RenderContext,
  type Renderer,
  type RenderOutput,
} from "./shared.js";

function commandMarkdown(c: CommandSource): string {
  return `<!-- ${MANAGED_NOTICE} -->\n# /${c.name}\n\n${c.description}\n\n${substituteArgs(c.body, "명령 뒤에 적은 내용")}\n`;
}

export const cursorRenderer: Renderer = {
  tool: "cursor",
  verified: {
    date: "2026-11-01",
    urls: [
      "https://docs.cursor.com/en/agent/chat/commands",
      "https://cursor.com/docs/context/commands",
      "https://cursor.com/docs/context/mcp",
    ],
  },
  supportsGlobal: false,
  render(commands: CommandSource[], ctx: RenderContext): RenderOutput {
    if (ctx.scope === "global") {
      return unsupportedGlobal("cursor", "레포에서 `npx dsmith install --tool cursor`를 실행하세요.");
    }
    const writes: PlannedWrite[] = commands.map((c) => ({
      file: path.join(ctx.root, ".cursor", "commands", `${c.name}.md`),
      region: { kind: "file" },
      content: commandMarkdown(c),
    }));
    writes.push(mcpJsonWrite(path.join(ctx.root, ".cursor", "mcp.json"), mcpServerEntry(ctx.mcp, { type: "stdio" })));
    return { writes, notes: [] };
  },
};
