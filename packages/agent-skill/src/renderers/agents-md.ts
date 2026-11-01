/**
 * AGENTS.md 렌더러(슬래시 명령이 없는 도구용 폴백). 규약 확인: 2026-11-01 (부록 A.3)
 * - AGENTS.md는 Codex가 읽는 지침 파일이다. 별도 규약이 없어 `<!-- dsmith:start -->…<!-- dsmith:end -->`
 *   마커 블록 하나만 쓰고 나머지 내용은 건드리지 않는다. 출처는 Codex 스킬 문서와 같다:
 *   https://learn.chatgpt.com/docs/build-skills
 * - 블록 ≤40줄. MCP 등록은 쓰지 않고(도구마다 다름) 블록 안에 서버 실행 명령 문장만 둔다.
 * 규약이 바뀌면 이 파일만 고친다.
 */
import path from "node:path";
import type { CommandSource } from "../commands.js";
import { MD_MARKERS, launchLine, unsupportedGlobal, type RenderContext, type Renderer, type RenderOutput } from "./shared.js";

export const MCP_TOOL_NAMES = [
  "resolve_token",
  "lint_snippet",
  "search_component",
  "get_component",
  "explain_decision",
  "list_decisions",
] as const;

/** description의 첫 문장(표 셀용). */
function firstSentence(description: string): string {
  const m = /^(.+?[.!?])(\s|$)/s.exec(description.trim());
  return (m?.[1] ?? description.trim()).replace(/\.$/, "").replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ");
}

/** "슬래시 없을 때" 칸: uses의 첫 `cli:` 항목 → npx 명령, 없으면 MCP 필요 또는 아직 없음. */
function fallbackCell(c: CommandSource): string {
  const cli = c.uses.find((u) => u.startsWith("cli:"));
  if (cli !== undefined) {
    const [cmd, ...flags] = cli.slice("cli:".length).split(" ");
    const all = flags.includes("--json") ? flags : [...flags, "--json"];
    return `\`npx dsmith ${[cmd, ...all].join(" ")}\``;
  }
  return c.uses.some((u) => u.startsWith("mcp:")) ? "MCP 서버 필요" : "아직 없음";
}

function block(commands: CommandSource[], ctx: RenderContext): string {
  const rows = commands.map((c) => `| \`/${c.name}\` | ${firstSentence(c.description)} | ${fallbackCell(c)} |`);
  return [
    "## dsmith (디자인 시스템 도구)",
    "",
    "이 레포의 디자인 시스템 진단·결정·검사를 `dsmith`로 한다. 슬래시 명령이 없으면 오른쪽 열의 명령을 실행하고 JSON 출력을 읽어 설명한다.",
    "",
    "| 명령 | 하는 일 | 슬래시 없을 때 |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `MCP 서버 dsmith(\`${launchLine(ctx.mcp)}\`) 도구: ${MCP_TOOL_NAMES.join(", ")}`,
    "",
    "규칙:",
    "- 명령 출력 JSON에 없는 숫자는 말하지 않는다.",
    '- 결정은 사람이 고른 뒤 `npx dsmith decide --item "<이름>" --choose "<id>"` 로 기록한다.',
    "- 스타일 값을 하드코딩하기 전에 `resolve_token`으로 토큰을 찾는다.",
  ].join("\n");
}

export const agentsMdRenderer: Renderer = {
  tool: "agents-md",
  verified: { date: "2026-11-01", urls: ["https://learn.chatgpt.com/docs/build-skills"] },
  supportsGlobal: false,
  render(commands: CommandSource[], ctx: RenderContext): RenderOutput {
    if (ctx.scope === "global") {
      return unsupportedGlobal("agents-md", "레포에서 `npx dsmith install --tool agents-md`를 실행하세요.");
    }
    return {
      writes: [
        {
          file: path.join(ctx.root, "AGENTS.md"),
          region: { kind: "block", start: MD_MARKERS.start, end: MD_MARKERS.end },
          content: block(commands, ctx),
        },
      ],
      notes: [],
    };
  },
};
