import { createHash } from "node:crypto";
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
  /** 토큰 이름 → 출처(토큰 파일 / audit 제안). tokens가 바뀔 때만 다시 만든다 */
  tokenSources: Map<string, "token-file" | "proposal">;
  decisions: DecisionsFile;
  isDsModule: (module: string) => boolean;
  /** 읽은 파일들의 변경 키를 합친 짧은 해시. 데이터가 바뀌었는지 cursor가 확인하는 데 쓴다 */
  version: string;
}

export interface WorkspaceHandle {
  get(): Promise<Workspace>;
}

const DSMITH_DIR = ".dsmith";
const CSS_FILE = /\.(css|scss)$/i;

interface Stamps {
  index: string;
  detect: string;
  decisions: string;
  tokens: string;
}

/** 파일의 변경 감지 키. 없으면 "-". */
async function stamp(file: string): Promise<string> {
  try {
    const s = await fs.stat(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "-";
  }
}

async function tokenStamp(root: string, tokenFiles: string[]): Promise<string> {
  const parts = await Promise.all(tokenFiles.filter((f) => CSS_FILE.test(f)).map((f) => stamp(path.resolve(root, f))));
  return parts.join("|");
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sourcesOf(tokens: LoadedTokens): Map<string, "token-file" | "proposal"> {
  return new Map(tokens.tokens.map((t) => [t.name, t.source]));
}

function versionOf(stamps: Stamps): string {
  return createHash("sha1").update(JSON.stringify(stamps)).digest("hex").slice(0, 8);
}

/**
 * 워크스페이스를 연다. 파일은 한 번씩만 읽고(키를 읽기 전에 잡는다), 이후 `get()`마다 index.json·detect.json·decisions.json과
 * 토큰 파일의 mtime+size를 stat해 바뀐 것만 다시 읽는다. 다시 읽기가 실패하면 마지막 정상 스냅샷을 유지하고(키는 그대로 두어 다음 호출이 재시도) stderr에 남긴다.
 * detect.json·index.json 중 하나라도 없으면 `deps.ensureIndex(root)`를 1회 부른 뒤 읽는다. prepare 실패는 서버를 죽이지 않는다.
 */
export async function openWorkspace(deps: ServerDeps): Promise<WorkspaceHandle> {
  const root = path.resolve(deps.root);
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const dsmith = (name: string): string => path.join(root, DSMITH_DIR, name);

  for (const extractor of deps.extractors) {
    try {
      await extractor.prepare?.(root);
    } catch (err) {
      log(`dsmith mcp: prepare(${extractor.name}) 실패: ${messageOf(err)}`);
    }
  }

  /** 바뀐 조각만 다시 읽어 새 스냅샷을 만든다. prev가 없으면 전부 읽고, index·detect가 없으면 null. */
  async function load(prev: Workspace | null, prevStamps: Stamps | null): Promise<{ ws: Workspace; stamps: Stamps } | null> {
    // 키는 읽기 전에 잡는다 — 읽는 도중의 변경은 다음 호출이 다시 읽는다.
    const now = {
      index: await stamp(dsmith("index.json")),
      detect: await stamp(dsmith("detect.json")),
      decisions: await stamp(dsmith("decisions.json")),
    };
    const stamps: Stamps = { ...now, tokens: prevStamps?.tokens ?? "" };
    const changed = (k: "index" | "detect" | "decisions"): boolean => prevStamps === null || prevStamps[k] !== now[k];

    /** 바뀌었으면 읽고, 실패하면 prev 값을 유지(키도 그대로). prev가 없으면 한국어 오류. */
    async function piece<V>(k: "index" | "detect" | "decisions", file: string, read: () => Promise<V>, fallback: V | undefined): Promise<V | undefined> {
      if (!changed(k)) return fallback;
      try {
        return await read();
      } catch (err) {
        if (fallback === undefined) throw new Error(`${DSMITH_DIR}/${file}을 읽을 수 없음: ${messageOf(err)}`);
        log(`dsmith mcp: ${DSMITH_DIR}/${file}을 다시 읽지 못해 이전 데이터를 유지함: ${messageOf(err)}`);
        stamps[k] = prevStamps?.[k] ?? "";
        return fallback;
      }
    }

    const index = await piece("index", "index.json", () => readIndex(root).then((v) => v ?? undefined), prev?.index);
    const detect = await piece("detect", "detect.json", () => readDetect(root).then((v) => v ?? undefined), prev?.detect);
    if (index === undefined || detect === undefined) {
      if (prev === null) return null;
      throw new Error(`${DSMITH_DIR}/index.json·detect.json이 없어짐`);
    }
    const decisions = (await piece("decisions", "decisions.json", () => readDecisions(root), prev?.decisions)) ?? { version: 1 as const, items: [] };

    const components = index === prev?.index ? prev.components : summarizeComponents(index.components);
    const isDsModule = detect === prev?.detect ? prev.isDsModule : (m: string): boolean => isDsSpecifier(m, detect.ds);

    // 토큰 파일의 키도 읽기 전에 잡는다.
    const tokensStamp = await tokenStamp(root, detect.ds.tokenFiles);
    let tokens = prev?.tokens;
    let tokenSources = prev?.tokenSources;
    if (tokens === undefined || index !== prev?.index || detect !== prev.detect || tokensStamp !== prevStamps?.tokens) {
      try {
        tokens = await loadTokens(root, detect.ds.tokenFiles, index.styles);
        tokenSources = sourcesOf(tokens);
        stamps.tokens = tokensStamp;
      } catch (err) {
        if (tokens === undefined || tokenSources === undefined) throw err;
        log(`dsmith mcp: 토큰을 다시 읽지 못해 이전 데이터를 유지함: ${messageOf(err)}`);
        stamps.tokens = prevStamps?.tokens ?? "";
      }
    } else {
      stamps.tokens = tokensStamp;
    }
    if (tokens === undefined || tokenSources === undefined) throw new Error("토큰을 읽을 수 없음");

    const ws: Workspace = { root, detect, index, components, tokens, tokenSources, decisions, isDsModule, version: versionOf(stamps) };
    return { ws, stamps };
  }

  let loaded = await load(null, null);
  if (loaded === null) {
    await deps.ensureIndex(root);
    loaded = await load(null, null);
  }
  if (loaded === null) throw new Error(`${DSMITH_DIR}/index.json·detect.json을 만들 수 없음: ${root}`);
  let current = loaded;

  // 동시에 들어온 요청이 같은 재읽기를 겹쳐 하지 않도록 직렬화한다.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    get(): Promise<Workspace> {
      const run = queue.then(async () => {
        try {
          const next = await load(current.ws, current.stamps);
          if (next !== null) current = next;
        } catch (err) {
          log(`dsmith mcp: 이전 데이터를 유지함: ${messageOf(err)}`);
        }
        return current.ws;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

/** LoadedTokens.source("mixed" 포함)를 응답용 TokenSourceKind로 바꾼다. 섞였으면 토큰 파일이 주 출처다. */
export function tokenSourceKind(tokens: LoadedTokens): TokenSourceKind {
  return tokens.source === "proposal" ? "proposal" : "token-file";
}
