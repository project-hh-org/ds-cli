import fs from "node:fs";
import path from "node:path";
import { startStdioServer } from "@dsmith-dev/mcp-server";
import { buildExtractors, registry } from "../registry.js";
import { runAudit } from "./audit.js";

export interface McpCommandOptions {
  /** 없으면 cwd에서 위로 올라가며 `.dsmith/` 또는 `.git`이 있는 가장 가까운 디렉터리 */
  root?: string | undefined;
  budget?: number | undefined;
  git?: boolean | undefined;
}

/** AI 도구는 서버를 레포 하위 디렉터리에서 띄울 수도 있다 — `.dsmith/`나 `.git`(파일 포함: 워크트리·서브모듈)이 있는 가장 가까운 조상, 없으면 시작 디렉터리. */
export function findProjectRoot(start: string): string {
  const origin = path.resolve(start);
  for (let dir = origin; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".dsmith")) || fs.existsSync(path.join(dir, ".git"))) return dir;
    if (path.dirname(dir) === dir) return origin;
  }
}

function cliVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * stdio MCP 서버를 띄운다. stdout은 JSON-RPC 전용이라 이 함수는 아무것도 출력하지 않고, 로그는 stderr로만 보낸다.
 * 인덱스(.dsmith/index.json·detect.json)가 없으면 audit을 1회 돌려 만든다.
 */
export async function runMcp(opts: McpCommandOptions = {}): Promise<void> {
  // 사용자 설정 파일(tailwind.config 등)이 console.log로 stdout을 더럽히지 않게 한다.
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;

  const root = opts.root === undefined ? findProjectRoot(process.cwd()) : path.resolve(opts.root);
  await startStdioServer({
    root,
    version: cliVersion(),
    extractors: buildExtractors(Object.keys(registry)),
    ensureIndex: async (r) => {
      await runAudit(r);
    },
    ...(opts.budget === undefined ? {} : { tokenBudget: opts.budget }),
    ...(opts.git === undefined ? {} : { git: opts.git }),
  });
}
