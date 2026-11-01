/**
 * Claude Code 렌더러. 규약 확인: 2026-11-01 (부록 A.2)
 * - 스킬: 프로젝트 `.claude/skills/<name>/SKILL.md`, 개인 `~/.claude/skills/<name>/SKILL.md`.
 *   frontmatter 필드는 전부 선택(`description` 권장), `name`은 / 메뉴의 명령 이름(기본값 디렉터리 이름),
 *   `argument-hint`를 지원한다. 인자는 `$ARGUMENTS`. https://code.claude.com/docs/en/skills
 * - MCP: 프로젝트 루트 `.mcp.json`의 `mcpServers.<name>` = `{ command, args, env }`, `type` 생략 시 stdio.
 *   프로젝트 서버는 처음 쓸 때 승인을 묻는다. https://code.claude.com/docs/en/mcp
 * - Agent Skills 규격(name = 부모 디렉터리 이름, 소문자·숫자·하이픈 ≤64자): https://agentskills.io/specification
 * 규약이 바뀌면 이 파일만 고친다.
 */
import path from "node:path";
import type { PlannedWrite } from "@dsmith-dev/core";
import type { CommandSource } from "../commands.js";
import { launchLine, mcpJsonWrite, mcpServerEntry, skillMarkdown, withCli, type RenderContext, type Renderer, type RenderOutput } from "./shared.js";

export const claudeCodeRenderer: Renderer = {
  tool: "claude-code",
  verified: {
    date: "2026-11-01",
    urls: [
      "https://code.claude.com/docs/en/skills",
      "https://code.claude.com/docs/en/mcp",
      "https://agentskills.io/specification",
    ],
  },
  supportsGlobal: true,
  render(commands: CommandSource[], ctx: RenderContext): RenderOutput {
    const base = ctx.scope === "global" ? ctx.home : ctx.root;
    const writes: PlannedWrite[] = withCli(commands, ctx.cli).map((c) => ({
      file: path.join(base, ".claude", "skills", c.name, "SKILL.md"),
      region: { kind: "file" },
      content: skillMarkdown(c, "$ARGUMENTS", { argumentHint: true }),
    }));

    if (ctx.scope === "global") {
      // 사용자 범위 MCP는 ~/.claude.json에 들어가고 그 파일 규약은 확인하지 않았다 — CLI에 맡긴다.
      return {
        writes,
        notes: [`MCP는 직접 등록하세요: claude mcp add --scope user dsmith -- ${launchLine(ctx.mcp)}`],
      };
    }
    writes.push(mcpJsonWrite(path.join(ctx.root, ".mcp.json"), mcpServerEntry(ctx.mcp)));
    return { writes, notes: ["Claude Code는 프로젝트 .mcp.json 서버를 처음 쓸 때 승인을 묻습니다. 승인하세요."] };
  },
};
