import type { PlannedWrite } from "@dsmith-dev/core";
import { stringify } from "yaml";
import type { CommandSource } from "../commands.js";
import type { AiTool } from "../detect-tools.js";
import type { McpLaunch } from "../mcp-launch.js";

export interface RenderContext {
  /** 레포 루트(절대 경로) */
  root: string;
  /** 사용자 홈(절대 경로) */
  home: string;
  scope: "repo" | "global";
  mcp: McpLaunch;
  /**
   * 명령 본문과 AGENTS.md 블록이 부르는 CLI 실행 명령(기본 `npx dsmith`). 배포 전 로컬 빌드에서는
   * `node /abs/packages/cli/dist/bin.js`처럼 MCP 실행 명령과 같은 빌드를 가리키게 한다.
   */
  cli?: string;
}

export const DEFAULT_CLI = "npx dsmith";

/** 명령 소스의 본문에서 `npx dsmith`를 `cli`로 바꾼다. 기본값이면 입력을 그대로 돌려줘 출력이 바이트 동일하다. */
export function withCli(commands: CommandSource[], cli: string | undefined): CommandSource[] {
  if (cli === undefined || cli === DEFAULT_CLI) return commands;
  return commands.map((c) => ({ ...c, body: c.body.replaceAll(DEFAULT_CLI, () => cli) }));
}

/** 사람에게 보이는 안내 문장의 `npx dsmith`를 `cli`로 바꾼다. */
export function cliText(text: string, cli: string | undefined): string {
  return cli === undefined || cli === DEFAULT_CLI ? text : text.replaceAll(DEFAULT_CLI, () => cli);
}

export interface RenderOutput {
  /** `safeWrite`에 그대로 넘긴다. */
  writes: PlannedWrite[];
  /** 사람이 직접 할 일(예: Codex 신뢰 프로젝트, 글로벌 미지원). */
  notes: string[];
}

export interface Renderer {
  tool: AiTool;
  /** 부록 A의 확인 날짜·URL */
  verified: { date: string; urls: string[] };
  supportsGlobal: boolean;
  render(commands: CommandSource[], ctx: RenderContext): RenderOutput;
}

export const MANAGED_NOTICE =
  "dsmith install이 관리하는 파일입니다. 직접 고치면 다음 install이 덮어쓰지 않습니다(--force로 덮어씀).";

export const MD_MARKERS = { start: "<!-- dsmith:start -->", end: "<!-- dsmith:end -->" } as const;
export const TOML_MARKERS = { start: "# dsmith:start", end: "# dsmith:end" } as const;

/** 본문의 `{{args}}`를 도구별 인자 표현으로 바꾼다. `$` 패턴이 해석되지 않게 함수 치환을 쓴다. */
export function substituteArgs(body: string, replacement: string): string {
  return body.replaceAll("{{args}}", () => replacement);
}

/** MCP 서버 항목. `extra`(예: Cursor의 `type`)를 앞에 두고 `command`·`args`를 붙인다. */
export function mcpServerEntry(launch: McpLaunch, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, command: launch.command, args: launch.args };
}

/** 사람이 읽는 실행 명령 한 줄(`npx -y dsmith@0.2 mcp`). */
export function launchLine(launch: McpLaunch): string {
  return [launch.command, ...launch.args].join(" ");
}

/** Agent Skills 형식(claude-code·codex 공통) SKILL.md. 버전 문자열은 넣지 않는다 — 버전은 매니페스트에 기록된다. */
export function skillMarkdown(
  command: CommandSource,
  argsReplacement: string,
  opts: { argumentHint?: boolean } = {},
): string {
  const front: Record<string, string> = { name: command.name, description: command.description };
  if (opts.argumentHint === true && command.args !== undefined) front["argument-hint"] = command.args;
  // lineWidth 0: 긴 한국어 description을 여러 줄로 접지 않는다.
  const yamlText = stringify(front, { lineWidth: 0 }).trimEnd();
  return `---\n${yamlText}\n---\n\n<!-- ${MANAGED_NOTICE} -->\n\n${substituteArgs(command.body, argsReplacement)}\n`;
}

/** 영역이 `["mcpServers","dsmith"]`인 JSON 키 쓰기. */
export function mcpJsonWrite(file: string, entry: Record<string, unknown>): PlannedWrite {
  return { file, region: { kind: "json-key", keyPath: ["mcpServers", "dsmith"] }, content: JSON.stringify(entry) };
}

/** 글로벌 미지원 도구가 `--global`에서 내는 결과. */
export function unsupportedGlobal(tool: AiTool, hint: string): RenderOutput {
  return { writes: [], notes: [`${tool}은(는) --global을 지원하지 않습니다. ${hint}`] };
}
