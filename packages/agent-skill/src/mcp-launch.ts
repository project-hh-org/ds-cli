/** AI 도구가 MCP 서버를 띄울 때 쓰는 실행 명령. */
export interface McpLaunch {
  command: string;
  args: string[];
}

/**
 * 배포 버전용 기본 실행 명령. 0.x는 minor까지(0.2.0 → `dsmith@0.2`), 1.x 이상은 major만(`dsmith@1`) 고정한다.
 * 0.x는 minor가 호환 경계라서다. prerelease(`0.3.0-beta.1`)는 범위 `dsmith@0.3`이 정식판을 가리켜
 * 시험판이 아닌 버전이 깔리므로 정확한 버전으로 고정한다.
 */
export function defaultMcpLaunch(version: string): McpLaunch {
  const m = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (m === null) throw new Error(`dsmith 버전 형식이 아님: ${JSON.stringify(version)}`);
  const [, major = "", minor = "", patch = "", prerelease] = m;
  const spec =
    prerelease !== undefined ? `${major}.${minor}.${patch}${prerelease}` : Number(major) >= 1 ? major : `0.${minor}`;
  return { command: "npx", args: ["-y", `dsmith@${spec}`, "mcp"] };
}

/**
 * `--mcp-command` 값을 실행 명령으로 바꾼다(로컬 개발용). 공백으로 나누고 끝에 `mcp`를 붙인다.
 * 값 끝에 이미 `mcp`를 적었으면(`node /x/bin.js mcp`) 한 번만 붙는다.
 * 따옴표는 지원하지 않으므로 공백이 든 경로는 쓸 수 없다.
 */
export function parseMcpCommand(value: string): McpLaunch {
  const tokens = value.trim().split(/\s+/);
  const [command, ...rest] = tokens;
  if (command === undefined || command === "") throw new Error("--mcp-command 값이 비어 있음");
  if (rest.at(-1) === "mcp") rest.pop();
  return { command, args: [...rest, "mcp"] };
}
