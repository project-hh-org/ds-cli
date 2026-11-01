import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";

/**
 * 대상 레포에 파일을 내려쓸 때 사용자가 고친 내용을 지키는 쓰기 계층.
 * 쓰는 단위는 "영역"(전용 파일 / 마커 블록 / JSON 키 하나)이고, 영역마다 마지막으로 쓴 내용의
 * sha256을 매니페스트에 기록해 두었다가 현재 내용과 비교한다. 해시가 어긋나면 사용자가 고친 것으로 보고
 * `force` 없이는 쓰지 않는다. 파싱할 수 없는 파일(깨진 JSON, 짝이 안 맞는 마커)은 `force`여도 쓰지 않는다.
 */

export type ManagedRegion =
  | { kind: "file" } // 파일 전체가 dsmith 소유(전용 경로)
  | { kind: "block"; start: string; end: string } // 마커 줄 사이(마커 줄 제외)
  | { kind: "json-key"; keyPath: string[] }; // JSON 파일의 한 키 값

export interface PlannedWrite {
  /** 절대 경로 */
  file: string;
  region: ManagedRegion;
  /** file/block: 텍스트(끝 개행 하나로 정규화), json-key: JSON.stringify(value) */
  content: string;
}

export type WriteStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "skipped-modified"
  | "skipped-unowned"
  | "skipped-invalid";

export interface WriteOutcome {
  /** displayRoot 상대(밖이면 `~/` 또는 절대) */
  file: string;
  region: ManagedRegion["kind"];
  status: WriteStatus;
  /** dryRun이거나 skipped-*일 때 현재 → 원하는 내용의 unified diff */
  diff?: string;
  reason?: string;
}

export interface SafeWriteOptions {
  /** 절대 경로. install: `<root>/.dsmith/install.json` (--global: `~/.dsmith/install.json`) */
  manifestFile: string;
  displayRoot: string;
  /** 표시용 `~/` 치환 */
  home?: string;
  dryRun?: boolean;
  force?: boolean;
  /** 매니페스트 tool 필드("install" | 3b "init" | "ai") */
  tool: string;
  /** dsmith 버전(매니페스트 기록용) */
  version: string;
}

export interface SafeWriteResult {
  outcomes: WriteOutcome[];
  applied: boolean;
  manifestChanged: boolean;
}

export interface WriteManifest {
  version: 1;
  tool: string;
  dsmith: string;
  /** 키 = regionKey */
  entries: Record<string, { sha256: string }>;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const toLf = (text: string): string => text.replace(/\r\n/g, "\n");
const toPosix = (p: string): string => p.split(path.sep).join("/");

/** 끝 개행을 하나로 정규화한다(빈 문자열은 그대로). */
function normalizeText(content: string): string {
  const body = toLf(content).replace(/\n+$/, "");
  return body === "" ? "" : `${body}\n`;
}

function isInside(root: string, target: string): string | null {
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

/** displayRoot 안이면 상대 경로, 밖이면 절대 경로(매니페스트 키용). */
function relOrAbsolute(file: string, displayRoot: string): string {
  return isInside(displayRoot, file) ?? toPosix(file);
}

function displayPath(file: string, displayRoot: string, home: string | undefined): string {
  const rel = isInside(displayRoot, file);
  if (rel !== null) return rel;
  if (home !== undefined) {
    const underHome = isInside(home, file);
    if (underHome !== null) return `~/${underHome}`;
  }
  return toPosix(file);
}

/** `<rel>` | `<rel>#block:<start>` | `<rel>#json:<keyPath.join(".")>` */
export function regionKey(w: PlannedWrite, displayRoot: string): string {
  const rel = relOrAbsolute(w.file, displayRoot);
  switch (w.region.kind) {
    case "file":
      return rel;
    case "block":
      return `${rel}#block:${w.region.start}`;
    case "json-key":
      return `${rel}#json:${w.region.keyPath.join(".")}`;
  }
}

// ---------------------------------------------------------------------------
// 영역 어댑터: 파일 전체 텍스트(null = 파일 없음)에서 현재 영역 텍스트를 읽고, 원하는 내용을 반영한 새 파일 텍스트를 만든다.

type RegionRead = { ok: true; current: string | null } | { ok: false; reason: string };

interface Adapter {
  read(fileText: string | null): RegionRead;
  /** 원하는 영역 텍스트(정규 형태)를 반영한 새 파일 텍스트. read가 ok일 때만 호출한다. */
  apply(fileText: string | null, desired: string): string;
  /** 비교·해시에 쓰는 정규 형태의 원하는 내용 */
  desired: string;
}

function fileAdapter(content: string): Adapter {
  const desired = normalizeText(content);
  return {
    desired,
    read: (text) => ({ ok: true, current: text === null ? null : toLf(text) }),
    apply: (_text, d) => d,
  };
}

interface BlockSpan {
  lines: string[];
  startIdx: number;
  endIdx: number;
}

function locateBlock(text: string, start: string, end: string): { span: BlockSpan | null } | { error: string } {
  const lines = text.split("\n");
  const startIdxs: number[] = [];
  const endIdxs: number[] = [];
  lines.forEach((line, i) => {
    const t = line.replace(/\r$/, "").trim();
    if (t === start) startIdxs.push(i);
    if (t === end) endIdxs.push(i);
  });
  if (startIdxs.length === 0 && endIdxs.length === 0) return { span: null };
  if (startIdxs.length > 1 || endIdxs.length > 1) return { error: "dsmith 마커가 두 번 이상 있음" };
  const [startIdx] = startIdxs;
  const [endIdx] = endIdxs;
  if (startIdx === undefined || endIdx === undefined) return { error: "시작·끝 마커의 짝이 맞지 않음" };
  if (endIdx < startIdx) return { error: "끝 마커가 시작 마커보다 앞에 있음" };
  return { span: { lines, startIdx, endIdx } };
}

function blockAdapter(content: string, start: string, end: string): Adapter {
  const desired = normalizeText(content);
  return {
    desired,
    read(text) {
      if (text === null) return { ok: true, current: null };
      const found = locateBlock(text, start, end);
      if ("error" in found) return { ok: false, reason: found.error };
      if (found.span === null) return { ok: true, current: null };
      const { lines, startIdx, endIdx } = found.span;
      const inner = lines.slice(startIdx + 1, endIdx).map((l) => l.replace(/\r$/, ""));
      return { ok: true, current: inner.length === 0 ? "" : `${inner.join("\n")}\n` };
    },
    apply(text, d) {
      const crlf = text !== null && text.includes("\r\n");
      const eol = crlf ? "\r\n" : "\n";
      const bodyLines = d === "" ? [] : d.replace(/\n$/, "").split("\n");
      if (text !== null) {
        const found = locateBlock(text, start, end);
        if (!("error" in found) && found.span !== null) {
          const { lines, startIdx, endIdx } = found.span;
          const cr = crlf ? "\r" : "";
          return [...lines.slice(0, startIdx + 1), ...bodyLines.map((l) => `${l}${cr}`), ...lines.slice(endIdx)].join(
            "\n",
          );
        }
      }
      const block = [start, ...bodyLines, end].join(eol) + eol;
      if (text === null || text === "") return block;
      const withEol = text.endsWith("\n") ? text : text + eol;
      return `${withEol}${eol}${block}`;
    },
  };
}

type ParsedJson = { ok: true; root: Record<string, unknown> } | { ok: false; reason: string };

function parseJsonRoot(text: string | null): ParsedJson {
  if (text === null || text.trim() === "") return { ok: true, root: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "JSON으로 파싱할 수 없음" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "JSON 최상위가 객체가 아님" };
  }
  return { ok: true, root: value as Record<string, unknown> };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function detectIndent(text: string | null): string {
  if (text === null) return "  ";
  const m = /^([ \t]+)\S/m.exec(text);
  return m?.[1] ?? "  ";
}

function jsonKeyAdapter(content: string, keyPath: string[]): Adapter {
  // 입력 오류는 호출자 버그이므로 던진다. 정규 형태(JSON.stringify)로 맞춘다.
  const desired = JSON.stringify(JSON.parse(content));
  const pathError = keyPath.length === 0 || keyPath.includes("__proto__") ? "keyPath가 올바르지 않음" : null;
  return {
    desired,
    read(text) {
      if (pathError !== null) return { ok: false, reason: pathError };
      const parsed = parseJsonRoot(text);
      if (!parsed.ok) return parsed;
      let node: unknown = parsed.root;
      for (const [i, key] of keyPath.entries()) {
        if (!isPlainObject(node)) return { ok: false, reason: `${keyPath.slice(0, i).join(".")} 가 객체가 아님` };
        if (!Object.hasOwn(node, key)) return { ok: true, current: null };
        node = node[key];
      }
      return { ok: true, current: JSON.stringify(node) };
    },
    apply(text, d) {
      const parsed = parseJsonRoot(text);
      if (!parsed.ok) throw new Error(parsed.reason);
      let node: Record<string, unknown> = parsed.root;
      for (const key of keyPath.slice(0, -1)) {
        const next = Object.hasOwn(node, key) ? node[key] : undefined;
        if (isPlainObject(next)) {
          node = next;
        } else {
          const created: Record<string, unknown> = {};
          node[key] = created;
          node = created;
        }
      }
      const last = keyPath[keyPath.length - 1];
      if (last === undefined) throw new Error("keyPath가 비어 있음");
      node[last] = JSON.parse(d);
      return `${JSON.stringify(parsed.root, null, detectIndent(text))}\n`;
    },
  };
}

function adapterFor(w: PlannedWrite): Adapter {
  switch (w.region.kind) {
    case "file":
      return fileAdapter(w.content);
    case "block":
      return blockAdapter(w.content, w.region.start, w.region.end);
    case "json-key":
      return jsonKeyAdapter(w.content, w.region.keyPath);
  }
}

// ---------------------------------------------------------------------------

async function readTextOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readManifest(file: string, tool: string, version: string): Promise<WriteManifest> {
  const empty: WriteManifest = { version: 1, tool, dsmith: version, entries: {} };
  const text = await readTextOrNull(file);
  if (text === null) return empty;
  try {
    const parsed = JSON.parse(text) as Partial<WriteManifest>;
    if (parsed.version === 1 && isPlainObject(parsed.entries)) {
      return {
        version: 1,
        tool: typeof parsed.tool === "string" ? parsed.tool : tool,
        dsmith: typeof parsed.dsmith === "string" ? parsed.dsmith : version,
        entries: { ...(parsed.entries as WriteManifest["entries"]) },
      };
    }
  } catch {
    // 깨진 매니페스트는 비어 있는 것으로 본다 — 모든 기존 영역이 skipped-unowned가 되어 안전한 쪽으로 기운다.
  }
  return empty;
}

function patch(rel: string, before: string | null, after: string): string {
  return createTwoFilesPatch(rel, rel, before ?? "", after, "", "", { context: 3 });
}

export async function safeWrite(writes: PlannedWrite[], opts: SafeWriteOptions): Promise<SafeWriteResult> {
  const manifest = await readManifest(opts.manifestFile, opts.tool, opts.version);
  const entries = manifest.entries;
  let manifestChanged = false;

  // 같은 파일에 여러 영역을 쓸 수 있으므로 파일별 텍스트를 메모리에서 이어 간다.
  const texts = new Map<string, string | null>();
  const dirty = new Set<string>();
  const outcomes: WriteOutcome[] = [];

  for (const w of writes) {
    const rel = displayPath(w.file, opts.displayRoot, opts.home);
    const key = regionKey(w, opts.displayRoot);
    const adapter = adapterFor(w);
    const base = { file: rel, region: w.region.kind } as const;

    if (!texts.has(w.file)) texts.set(w.file, await readTextOrNull(w.file));
    const text = texts.get(w.file) ?? null;

    const read = adapter.read(text);
    if (!read.ok) {
      outcomes.push({ ...base, status: "skipped-invalid", reason: read.reason });
      continue;
    }

    const { current } = read;
    const desired = adapter.desired;
    const recorded = entries[key]?.sha256;

    let status: WriteStatus;
    let reason: string | undefined;
    if (current === null) {
      status = "created";
    } else if (current === desired) {
      status = "unchanged";
    } else if (recorded !== undefined && recorded === sha256(current)) {
      status = "updated";
    } else if (recorded !== undefined) {
      status = opts.force ? "updated" : "skipped-modified";
      if (status === "skipped-modified") reason = "사용자가 수정한 영역 — 덮어쓰려면 --force";
    } else {
      status = opts.force ? "updated" : "skipped-unowned";
      if (status === "skipped-unowned") reason = "dsmith가 쓴 적 없는 기존 내용 — 덮어쓰려면 --force";
    }

    if (status === "unchanged") {
      // 채택: 매니페스트에 없거나 해시가 낡았으면 현재 내용으로 맞춘다.
      const hash = sha256(desired);
      if (entries[key]?.sha256 !== hash) {
        entries[key] = { sha256: hash };
        manifestChanged = true;
      }
      outcomes.push({ ...base, status });
      continue;
    }

    const after = adapter.apply(text, desired);
    if (status === "skipped-modified" || status === "skipped-unowned") {
      outcomes.push({ ...base, status, ...(reason !== undefined ? { reason } : {}), diff: patch(rel, text, after) });
      continue;
    }

    // created | updated
    texts.set(w.file, after);
    dirty.add(w.file);
    entries[key] = { sha256: sha256(desired) };
    manifestChanged = true;
    outcomes.push({ ...base, status, ...(opts.dryRun ? { diff: patch(rel, text, after) } : {}) });
  }

  if (!opts.dryRun) {
    for (const file of dirty) {
      const text = texts.get(file);
      if (text === undefined || text === null) continue;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text, "utf-8");
    }
    if (manifestChanged) {
      const sorted: Record<string, { sha256: string }> = {};
      for (const k of Object.keys(entries).sort()) sorted[k] = entries[k] as { sha256: string };
      const out: WriteManifest = { version: 1, tool: opts.tool, dsmith: opts.version, entries: sorted };
      await fs.mkdir(path.dirname(opts.manifestFile), { recursive: true });
      await fs.writeFile(opts.manifestFile, `${JSON.stringify(out, null, 2)}\n`, "utf-8");
    }
  }

  return { outcomes, applied: !opts.dryRun, manifestChanged };
}
