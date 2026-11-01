import fs from "node:fs/promises";
import path from "node:path";
import {
  loadTokens,
  readDecisions,
  readIndex,
  summarizeComponents,
  type ComponentSummary,
  type DecisionsFile,
  type Index,
  type LoadedTokens,
  type TokenSourceKind,
} from "@dsmith-dev/core";
import { isDsSpecifier, readDetect, type DetectResult } from "@dsmith-dev/detect";
import type { ServerDeps } from "./index.js";

export interface Workspace {
  root: string;
  detect: DetectResult;
  index: Index;
  /** summarizeComponents(index.components) */
  components: ComponentSummary[];
  /** loadTokens(root, detect.ds.tokenFiles, index.styles) */
  tokens: LoadedTokens;
  decisions: DecisionsFile;
  isDsModule: (module: string) => boolean;
}

export interface WorkspaceHandle {
  get(): Promise<Workspace>;
}

const DSMITH_DIR = ".dsmith";

/** 파일의 변경 감지 키. 없으면 "-". */
async function stamp(file: string): Promise<string> {
  try {
    const s = await fs.stat(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "-";
  }
}

async function readAudited(root: string): Promise<{ index: Index | null; detect: DetectResult | null }> {
  const [index, detect] = await Promise.all([readIndex(root), readDetect(root)]);
  return { index, detect };
}

/**
 * 워크스페이스를 연다. detect.json·index.json 중 하나라도 없으면 `deps.ensureIndex(root)`를 1회 부른 뒤 읽는다.
 * 이후 `get()`마다 index.json·detect.json·decisions.json(과 읽은 토큰 파일)의 mtime을 stat해
 * 바뀐 것만 다시 읽고 파생값을 다시 계산한다.
 */
export async function openWorkspace(deps: ServerDeps): Promise<WorkspaceHandle> {
  const root = path.resolve(deps.root);
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  // prepare 실패(깨진 설정 파일 등)는 서버를 죽이지 않는다 — 해당 Extractor만 기본 설정으로 동작한다.
  for (const extractor of deps.extractors) {
    try {
      await extractor.prepare?.(root);
    } catch (err) {
      log(`dsmith mcp: prepare(${extractor.name}) 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let audited = await readAudited(root);
  if (audited.index === null || audited.detect === null) {
    await deps.ensureIndex(root);
    audited = await readAudited(root);
  }
  if (audited.index === null) throw new Error(`${DSMITH_DIR}/index.json을 만들 수 없음: ${root}`);
  if (audited.detect === null) throw new Error(`${DSMITH_DIR}/detect.json을 만들 수 없음: ${root}`);

  const dsmith = (name: string): string => path.join(root, DSMITH_DIR, name);
  let index = audited.index;
  let detect = audited.detect;
  let decisions: DecisionsFile = { version: 1, items: [] };
  let components: ComponentSummary[] = [];
  let tokens: LoadedTokens = { source: "proposal", tokens: [], files: [], ignored: [], warnings: [] };
  let isDsModule = (module: string): boolean => isDsSpecifier(module, detect.ds);

  // 빈 키로 시작해 첫 refresh()가 전부 읽게 한다. 키는 읽기 전에 잡아 읽는 도중의 변경을 놓치지 않는다.
  let stamps = { index: "", detect: "", decisions: "", tokens: "" };

  async function refresh(): Promise<Workspace> {
    const next = {
      index: await stamp(dsmith("index.json")),
      detect: await stamp(dsmith("detect.json")),
      decisions: await stamp(dsmith("decisions.json")),
      tokens: await tokenStamp(root, tokens),
    };
    const indexChanged = next.index !== stamps.index;
    const detectChanged = next.detect !== stamps.detect;
    if (indexChanged) {
      const fresh = await readIndex(root);
      if (fresh !== null) {
        index = fresh;
        components = summarizeComponents(index.components);
      }
    }
    if (detectChanged) {
      const fresh = await readDetect(root);
      if (fresh !== null) {
        detect = fresh;
        isDsModule = (module: string): boolean => isDsSpecifier(module, detect.ds);
      }
    }
    if (next.decisions !== stamps.decisions) decisions = await readDecisions(root);
    if (indexChanged || detectChanged || next.tokens !== stamps.tokens) {
      tokens = await loadTokens(root, detect.ds.tokenFiles, index.styles);
      next.tokens = await tokenStamp(root, tokens);
    }
    stamps = next;
    return { root, detect, index, components, tokens, decisions, isDsModule };
  }

  // 동시에 들어온 요청이 같은 재읽기를 겹쳐 하지 않도록 직렬화한다.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    get(): Promise<Workspace> {
      const run = queue.then(refresh);
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

async function tokenStamp(root: string, tokens: LoadedTokens): Promise<string> {
  const parts = await Promise.all(tokens.files.map((f) => stamp(path.resolve(root, f))));
  return parts.join("|");
}

/** LoadedTokens.source("mixed" 포함)를 응답용 TokenSourceKind로 바꾼다. 섞였으면 토큰 파일이 주 출처다. */
export function tokenSourceKind(tokens: LoadedTokens): TokenSourceKind {
  return tokens.source === "proposal" ? "proposal" : "token-file";
}
