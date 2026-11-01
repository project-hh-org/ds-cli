/**
 * Codex 렌더러. 규약 확인: 2026-11-01 (부록 A.3)
 * - 스킬: 현재 디렉터리부터 레포 루트까지 `.agents/skills`를 스캔, 사용자 `$HOME/.agents/skills`.
 *   `SKILL.md`는 `name`·`description` 필수. 호출은 `$skill-name` 또는 `/skills`.
 *   https://learn.chatgpt.com/docs/build-skills (https://developers.openai.com/codex/skills 에서 302)
 * - MCP: `~/.codex/config.toml`, 프로젝트 `.codex/config.toml`(신뢰한 프로젝트에서만), 테이블 `[mcp_servers.<name>]`,
 *   stdio 필드 `command`(필수)·`args`·`env`·`env_vars`·`cwd`.
 *   https://learn.chatgpt.com/docs/extend/mcp?surface=cli (https://developers.openai.com/codex/mcp 에서 302)
 *   문서의 TOML 예시 원문은 확보하지 못했다 — 블록은 확인된 필드 이름으로 구성했다.
 * - 스펙 §1.1과의 차이: 스펙은 Codex MCP를 --global에서만 쓰라 했으나 프로젝트 `.codex/config.toml`이 확인돼
 *   repo 모드에서도 마커 블록으로 쓰고 신뢰 안내 note를 낸다.
 * - AGENTS.md 블록은 이 렌더러가 아니라 agents-md 렌더러가 쓴다(`normalizeTools`가 codex ⇒ +agents-md).
 * 규약이 바뀌면 이 파일만 고친다.
 */
import path from "node:path";
import type { PlannedWrite } from "@dsmith-dev/core";
import type { CommandSource } from "../commands.js";
import { TOML_MARKERS, skillMarkdown, withCli, type RenderContext, type Renderer, type RenderOutput } from "./shared.js";

function mcpBlock(ctx: RenderContext): string {
  const args = ctx.mcp.args.map((a) => JSON.stringify(a)).join(", ");
  return `[mcp_servers.dsmith]\ncommand = ${JSON.stringify(ctx.mcp.command)}\nargs = [${args}]\n`;
}

export const codexRenderer: Renderer = {
  tool: "codex",
  verified: {
    date: "2026-11-01",
    urls: ["https://learn.chatgpt.com/docs/build-skills", "https://learn.chatgpt.com/docs/extend/mcp?surface=cli"],
  },
  supportsGlobal: true,
  render(commands: CommandSource[], ctx: RenderContext): RenderOutput {
    const base = ctx.scope === "global" ? ctx.home : ctx.root;
    const writes: PlannedWrite[] = withCli(commands, ctx.cli).map((c) => ({
      file: path.join(base, ".agents", "skills", c.name, "SKILL.md"),
      region: { kind: "file" },
      content: skillMarkdown(c, "<사용자가 함께 준 인자, 없으면 생략>"),
    }));
    writes.push({
      file: path.join(base, ".codex", "config.toml"),
      region: { kind: "block", start: TOML_MARKERS.start, end: TOML_MARKERS.end },
      content: mcpBlock(ctx),
    });
    const notes =
      ctx.scope === "repo"
        ? ["Codex는 신뢰한 프로젝트에서만 .codex/config.toml을 읽습니다. 이 레포를 신뢰 프로젝트로 지정하세요."]
        : [];
    return { writes, notes };
  },
};
