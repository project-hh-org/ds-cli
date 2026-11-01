/** AI 도구가 MCP 서버를 띄울 때 쓰는 실행 명령. */
export interface McpLaunch {
  command: string;
  args: string[];
}

/**
 * 배포 버전용 기본 실행 명령. 0.x는 minor까지(0.2.0 → `dsmith@0.2`), 1.x 이상은 major만(`dsmith@1`) 고정한다.
 * 0.x는 minor가 호환 경계라서다.
 */
export function defaultMcpLaunch(version: string): McpLaunch {
  const m = /^(\d+)\.(\d+)\.\d+/.exec(version);
  if (m === null) throw new Error(`dsmith 버전 형식이 아님: ${JSON.stringify(version)}`);
  const major = Number(m[1]);
  const range = major >= 1 ? `${major}` : `0.${m[2]}`;
  return { command: "npx", args: ["-y", `dsmith@${range}`, "mcp"] };
}

/**
 * `--mcp-command` 값을 실행 명령으로 바꾼다(로컬 개발용). 공백으로 나누고 끝에 `mcp`를 붙인다.
 * 따옴표는 지원하지 않으므로 공백이 든 경로는 쓸 수 없다.
 */
export function parseMcpCommand(value: string): McpLaunch {
  const [command, ...rest] = value.trim().split(/\s+/);
  if (command === undefined || command === "") throw new Error("--mcp-command 값이 비어 있음");
  return { command, args: [...rest, "mcp"] };
}
