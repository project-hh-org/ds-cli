import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startStdioServer } from "@dsmith-dev/mcp-server";
import { buildExtractors, registry } from "../registry.js";
import { cliVersion } from "../version.js";
import { runAudit } from "./audit.js";

export interface McpCommandOptions {
  /** 없으면 cwd에서 위로 올라가며 `.git` 또는 `.dsmith/{detect,index}.json`이 있는 가장 가까운 디렉터리(findProjectRoot) */
  root?: string | undefined;
  budget?: number | undefined;
  git?: boolean | undefined;
}

const sameDir = (a: string, b: string): boolean => {
  if (path.resolve(a) === path.resolve(b)) return true;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
};

/**
 * AI 도구는 서버를 레포 하위 디렉터리에서 띄울 수도 있다. 시작 디렉터리에서 위로 올라가며 `.git`(파일 포함: 워크트리·서브모듈),
 * `.dsmith/detect.json`, `.dsmith/index.json` 중 하나가 있는 가장 가까운 디렉터리를 레포로 본다.
 * `.dsmith/install.json`만 있거나 빈 `.dsmith/`는 근거가 아니다 — `install --global`이 `~/.dsmith/install.json`을 쓰므로
 * 홈 아래 아무 폴더에서 서버를 띄워도 홈 전체가 레포가 되기 때문이다. 같은 이유로 `.git`이 없는 홈 디렉터리는 고르지 않는다.
 * 레포 모드로 install만 하고 아직 audit하지 않은 레포(.git도 없음)에서는 시작 디렉터리를 쓴다.
 * 근거가 있는 조상이 없어도 시작 디렉터리를 쓴다.
 */
export function findProjectRoot(start: string, home: string = os.homedir()): string {
  const origin = path.resolve(start);
  for (let dir = origin; ; dir = path.dirname(dir)) {
    const hasGit = fs.existsSync(path.join(dir, ".git"));
    const hasIndex = ["detect.json", "index.json"].some((f) => fs.existsSync(path.join(dir, ".dsmith", f)));
    if (hasGit || (hasIndex && !sameDir(dir, home))) return dir;
    if (path.dirname(dir) === dir) return origin;
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
