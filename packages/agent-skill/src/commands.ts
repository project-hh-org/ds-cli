import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/**
 * 슬래시 명령 소스. `commands/<name>.md` 한 파일이 도구 중립 명령 하나이고, 렌더러가 도구별 파일로 바꾼다.
 * 명령은 얇게 유지한다 — CLI를 `--json`으로 실행해 읽고 설명·확인하는 것까지만 본문에 둔다.
 */
export interface CommandSource {
  /** 파일명(확장자 제외)과 같다. agentskills 이름 규칙을 따른다. */
  name: string;
  description: string;
  /** 사람이 읽는 인자 힌트(예: `[--root <dir>]`). 본문의 `{{args}}` 자리에 들어가는 인자의 모양. */
  args?: string;
  /** 이 명령이 부르는 것: `cli:<서브커맨드>[ --플래그]` 또는 `mcp:<도구>`. */
  uses: string[];
  /** frontmatter 뒤의 마크다운(앞뒤 빈 줄 제거). */
  body: string;
}

/** dist/에서도 src/에서도 패키지 루트의 commands/를 가리킨다. */
export const COMMANDS_DIR: URL = new URL("../commands/", import.meta.url);

export const MAX_BODY_LINES = 40;
const FRONTMATTER_KEYS = ["name", "description", "args", "uses"];
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const USES_RE = /^(cli|mcp):[a-z_-]+( --[a-z-]+)*$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

function parseCommand(file: string, text: string): CommandSource {
  const match = FRONTMATTER_RE.exec(text);
  if (match === null) return fail(file, "frontmatter(---)가 없음");
  const [, rawFront = "", rawBody = ""] = match;

  let front: unknown;
  try {
    front = parse(rawFront);
  } catch (err) {
    return fail(file, `frontmatter를 YAML로 읽을 수 없음 — ${(err as Error).message}`);
  }
  if (front === null || typeof front !== "object" || Array.isArray(front)) return fail(file, "frontmatter가 객체가 아님");
  const fm = front as Record<string, unknown>;

  const unknownKeys = Object.keys(fm).filter((k) => !FRONTMATTER_KEYS.includes(k));
  if (unknownKeys.length > 0) {
    return fail(file, `알 수 없는 frontmatter 키: ${unknownKeys.join(", ")} (허용: ${FRONTMATTER_KEYS.join(", ")})`);
  }

  const stem = file.replace(/\.md$/, "");
  const { name, description, args, uses } = fm;
  if (typeof name !== "string" || !NAME_RE.test(name) || name.length > 64) {
    return fail(file, `name은 소문자·숫자·하이픈(≤64자)이어야 함: ${JSON.stringify(name)}`);
  }
  if (name !== stem) return fail(file, `name(${name})이 파일명(${stem})과 다름`);
  if (typeof description !== "string" || description.trim() === "" || description.length > 1024) {
    return fail(file, "description은 1~1024자 문자열이어야 함");
  }
  if (args !== undefined && typeof args !== "string") return fail(file, "args는 문자열이어야 함");
  if (!Array.isArray(uses)) return fail(file, "uses는 문자열 배열이어야 함(없으면 [])");
  for (const u of uses) {
    if (typeof u !== "string" || !USES_RE.test(u)) {
      return fail(file, `uses 항목 형식 위반(cli:<명령> 또는 mcp:<도구>): ${JSON.stringify(u)}`);
    }
  }

  const body = rawBody.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
  const lines = body === "" ? 0 : body.split("\n").length;
  if (lines > MAX_BODY_LINES) return fail(file, `본문이 ${lines}줄 — ${MAX_BODY_LINES}줄 이하여야 함`);
  const argSlots = body.split("{{args}}").length - 1;
  if (argSlots > 1) return fail(file, `{{args}}는 본문에 최대 1회(현재 ${argSlots}회)`);
  if (args !== undefined && argSlots === 0) return fail(file, "args를 선언했으면 본문에 {{args}}가 있어야 함");
  if (args === undefined && argSlots === 1) return fail(file, "본문에 {{args}}가 있으면 frontmatter에 args를 선언해야 함");

  return { name, description, ...(args !== undefined ? { args } : {}), uses: uses as string[], body };
}

/** `dir`의 `*.md`를 이름(파일명에서 확장자 제외) 오름차순으로 읽는다. 검증에 실패하면 파일명이 든 Error. */
export async function loadCommands(dir: URL = COMMANDS_DIR): Promise<CommandSource[]> {
  const dirPath = fileURLToPath(dir);
  // 확장자를 뗀 이름으로 정렬한다(".md"의 "."이 "-"보다 커서 `ds.md`가 맨 뒤로 가는 것을 피한다).
  const stems = (await fs.readdir(dirPath)).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
  const commands: CommandSource[] = [];
  for (const stem of stems) {
    const file = `${stem}.md`;
    commands.push(parseCommand(file, await fs.readFile(new URL(file, dir), "utf-8")));
  }
  return commands;
}
