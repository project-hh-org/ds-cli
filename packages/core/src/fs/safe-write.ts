import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";

/**
 * 대상 레포에 파일을 내려쓸 때 사용자가 고친 내용을 지키는 쓰기 계층.
 * 쓰는 단위는 "영역"(전용 파일 / 마커 블록 / JSON 키 하나)이고, 영역마다 마지막으로 쓴 내용의
 * sha256을 매니페스트에 기록해 두었다가 현재 내용과 비교한다. 해시가 어긋나면 사용자가 고친 것으로 보고
 * `force` 없이는 쓰지 않는다. 파싱할 수 없는 파일(깨진 JSON, 짝이 안 맞는 마커)은 `force`여도 쓰지 않는다.
 * 모든 대상은 `confineTo`(realpath 기준) 안에 있어야 한다 — 밖으로 향하는 심볼릭 링크는 쓰지 않는다.
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
  /**
   * 기본 managed(매니페스트 해시로 사용자 수정을 지킨다).
   * create-only: 새 파일만 쓴다 — region은 file만 허용. 이미 있으면 내용이 같을 때 unchanged, 다르면 `force`여도
   * skipped-exists(덮어쓰지 않음, diff 없음).
   */
  mode?: "managed" | "create-only";
}

export type WriteStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "skipped-modified"
  | "skipped-unowned"
  | "skipped-invalid"
  | "skipped-exists";

export interface WriteOutcome {
  /** displayRoot 상대(밖이면 `~/` 또는 절대) — 표시용 */
  file: string;
  /** 매니페스트 키(regionKey) */
  key: string;
  region: ManagedRegion["kind"];
  status: WriteStatus;
  /** dryRun이거나 skipped-*일 때 현재 → 원하는 내용의 unified diff */
  diff?: string;
  reason?: string;
}

export interface SafeWriteOptions {
  /** 절대 경로. install: `<root>/.dsmith/install.json` (--global: `~/.dsmith/install.json`). 매니페스트 키의 기준은 이 파일의 `../..` */
  manifestFile: string;
  /** 표시 전용. 매니페스트 키에는 쓰이지 않는다. */
  displayRoot: string;
  /**
   * 쓰기를 가둘 디렉터리(절대 경로): 레포 스코프는 레포 루트, 글로벌은 홈.
   * 대상(과 매니페스트)을 realpath로 풀었을 때 이 밖이면 쓰지 않는다(대상: skipped-invalid, 매니페스트: 예외).
   * 안쪽을 가리키는 심볼릭 링크는 허용한다.
   */
  confineTo: string;
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

/** 매니페스트에 기록되는 해시와 같은 방식으로 파일 전체 텍스트(BOM·CRLF 무시)의 sha256을 낸다 — `file` 영역 비교용. */
export function managedFileHash(text: string): string {
  return sha256(toLf(text.startsWith("﻿") ? text.slice(1) : text));
}
const toPosix = (p: string): string => p.split(path.sep).join("/");
const BOM = "﻿";

/** 끝 개행을 하나로 정규화한다(빈 문자열은 그대로). */
function normalizeText(content: string): string {
  const body = toLf(content).replace(/\n+$/, "");
  return body === "" ? "" : `${body}\n`;
}

/** target이 root 안(root 자신 제외)이면 posix 상대 경로, 아니면 null. */
function isInside(root: string, target: string): string | null {
  const rel = path.relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

function withinOrEqual(root: string, target: string): boolean {
  return target === root || isInside(root, target) !== null;
}

/** 매니페스트 키의 기준 디렉터리: `<base>/.dsmith/install.json` → `<base>` */
function manifestBase(manifestFile: string): string {
  return path.dirname(path.dirname(manifestFile));
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

/**
 * 매니페스트 키. 기준은 `manifestFile`의 `../..`(레포 스코프: 레포 루트, 글로벌: 홈)이라
 * 같은 매니페스트를 어느 cwd/displayRoot에서 쓰든 키가 같다. 기준 밖 파일은 절대 posix 경로.
 * `<rel>` | `<rel>#block:<start>` | `<rel>#json:<JSON.stringify(keyPath)>`
 */
export function regionKey(w: PlannedWrite, manifestFile: string): string {
  const rel = isInside(manifestBase(manifestFile), w.file) ?? toPosix(w.file);
  switch (w.region.kind) {
    case "file":
      return rel;
    case "block":
      return `${rel}#block:${w.region.start}`;
    case "json-key":
      return `${rel}#json:${JSON.stringify(w.region.keyPath)}`;
  }
}

// ---------------------------------------------------------------------------
// 영역 어댑터: 파일 전체 텍스트(null = 파일 없음, BOM 제외)에서 현재 영역 텍스트를 읽고,
// 원하는 내용을 반영한 새 파일 텍스트를 만든다.

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

const isMarkerLine = (line: string, marker: string): boolean => line.replace(/\r$/, "").trim() === marker;

function locateBlock(text: string, start: string, end: string): { span: BlockSpan | null } | { error: string } {
  const lines = text.split("\n");
  const startIdxs: number[] = [];
  const endIdxs: number[] = [];
  lines.forEach((line, i) => {
    if (isMarkerLine(line, start)) startIdxs.push(i);
    if (isMarkerLine(line, end)) endIdxs.push(i);
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
  // 호출자 버그는 던진다.
  if (start.trim() === "" || end.trim() === "" || /[\r\n]/.test(start + end)) {
    throw new Error("블록 마커는 한 줄짜리 비어 있지 않은 문자열이어야 함");
  }
  if (start.trim() === end.trim()) throw new Error("블록 시작·끝 마커가 같을 수 없음");
  const desired = normalizeText(content);
  for (const line of desired.split("\n")) {
    if (isMarkerLine(line, start.trim()) || isMarkerLine(line, end.trim())) {
      throw new Error("블록 내용에 마커 줄이 들어 있음");
    }
  }
  start = start.trim();
  end = end.trim();
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

/** 문자열 리터럴을 보존하며 주석과 후행 쉼표를 지운다. JSONC 판별용. */
function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 2;
    } else {
      out += c;
      i++;
    }
  }
  // 후행 쉼표: `,` 뒤에 공백만 있고 `}`/`]`가 오는 경우(문자열 밖)
  let result = "";
  let inString = false;
  for (let k = 0; k < out.length; k++) {
    const c = out[k] as string;
    if (inString) {
      result += c;
      if (c === "\\") {
        result += out[k + 1] ?? "";
        k++;
      } else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      result += c;
    } else if (c === ",") {
      const rest = /^\s*([}\]])/.exec(out.slice(k + 1));
      if (rest === null) result += c;
    } else result += c;
  }
  return result;
}

type ParsedJson = { ok: true; root: Record<string, unknown> } | { ok: false; reason: string };

function parseJsonRoot(text: string | null): ParsedJson {
  if (text === null || text.trim() === "") return { ok: true, root: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    try {
      JSON.parse(stripJsonc(text));
      return { ok: false, reason: "주석·후행 쉼표가 있는 JSONC라 자동 편집할 수 없음 — 직접 추가하거나 주석을 제거" };
    } catch {
      return { ok: false, reason: "JSON으로 파싱할 수 없음" };
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "JSON 최상위가 객체가 아님" };
  }
  return { ok: true, root: value as Record<string, unknown> };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 키로 시작하는 첫 줄(`"` 앞 공백)의 들여쓰기. 없으면 2칸. */
function detectIndent(text: string | null): string {
  if (text === null) return "  ";
  const m = /^([ \t]+)"/m.exec(text);
  return m?.[1] ?? "  ";
}

function jsonKeyAdapter(content: string, keyPath: string[]): Adapter {
  // 입력 오류는 호출자 버그이므로 던진다. 정규 형태(JSON.stringify)로 맞춘다.
  const desired = JSON.stringify(JSON.parse(content));
  const pathError = keyPath.length === 0 || keyPath.includes("__proto__") ? "keyPath가 올바르지 않음(비었거나 __proto__ 포함)" : null;
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
      const last = keyPath[keyPath.length - 1] as string;
      node[last] = JSON.parse(d);
      const out = `${JSON.stringify(parsed.root, null, detectIndent(text))}\n`;
      return text !== null && text.includes("\r\n") ? out.replace(/\n/g, "\r\n") : out;
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
// 경로 격리·파일 입출력

type Resolved = { ok: true; real: string } | { ok: false; reason: string };

/** 대상 또는 존재하는 가장 깊은 조상을 realpath로 풀고, 남은 경로를 이어 붙인다. 끊어진 심볼릭 링크는 거부. */
async function resolveReal(target: string): Promise<Resolved> {
  let cur = target;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(cur);
      return { ok: true, real: path.join(real, ...rest.reverse()) };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        return { ok: false, reason: `경로를 해석할 수 없음(${code ?? "unknown"})` };
      }
      try {
        if ((await fs.lstat(cur)).isSymbolicLink()) return { ok: false, reason: "끊어진 심볼릭 링크" };
      } catch {
        // 실제로 없는 경로 — 한 단계 위로
      }
      const parent = path.dirname(cur);
      if (parent === cur) return { ok: false, reason: "경로를 해석할 수 없음" };
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

async function resolveConfined(target: string, rootReal: string): Promise<Resolved> {
  const r = await resolveReal(target);
  if (!r.ok) return r;
  if (!withinOrEqual(rootReal, r.real)) {
    return { ok: false, reason: `심볼릭 링크 등으로 ${rootReal} 밖을 가리킴(${r.real}) — 쓰지 않음` };
  }
  return r;
}

interface FileState {
  text: string | null;
  bom: boolean;
}

async function readState(real: string): Promise<FileState> {
  try {
    const raw = await fs.readFile(real, "utf-8");
    return raw.startsWith(BOM) ? { text: raw.slice(1), bom: true } : { text: raw, bom: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { text: null, bom: false };
    throw err;
  }
}

/** 같은 디렉터리의 임시 파일에 쓰고 rename한다. 기존 파일의 권한을 유지한다. */
export async function atomicWrite(real: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(real), { recursive: true });
  const tmp = `${real}.tmp-${process.pid}`;
  try {
    await fs.writeFile(tmp, content, "utf-8");
    try {
      const st = await fs.stat(real);
      await fs.chmod(tmp, st.mode & 0o7777);
    } catch {
      // 새 파일 — 기본 권한
    }
    await fs.rename(tmp, real);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

async function readManifest(real: string, tool: string, version: string): Promise<WriteManifest> {
  const empty: WriteManifest = { version: 1, tool, dsmith: version, entries: Object.create(null) as WriteManifest["entries"] };
  const { text } = await readState(real);
  if (text === null) return empty;
  try {
    const parsed = JSON.parse(text) as Partial<WriteManifest>;
    if (parsed.version === 1 && isPlainObject(parsed.entries)) {
      const entries = Object.create(null) as WriteManifest["entries"];
      for (const k of Object.keys(parsed.entries)) {
        const e = (parsed.entries as Record<string, unknown>)[k];
        if (isPlainObject(e) && typeof e.sha256 === "string") entries[k] = { sha256: e.sha256 };
      }
      return {
        version: 1,
        tool: typeof parsed.tool === "string" ? parsed.tool : tool,
        dsmith: typeof parsed.dsmith === "string" ? parsed.dsmith : version,
        entries,
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
  for (const [name, p] of [
    ["manifestFile", opts.manifestFile],
    ["confineTo", opts.confineTo],
    ...writes.map((w) => ["file", w.file] as const),
  ] as const) {
    if (!path.isAbsolute(p)) throw new Error(`safeWrite: ${name}는 절대 경로여야 함: ${p}`);
  }

  let rootReal: string;
  try {
    rootReal = await fs.realpath(opts.confineTo);
  } catch {
    throw new Error(`safeWrite: confineTo를 찾을 수 없음: ${opts.confineTo}`);
  }

  // 매니페스트: 심볼릭 링크 자체는 거부, 풀린 경로는 confineTo 안이어야 한다.
  try {
    if ((await fs.lstat(opts.manifestFile)).isSymbolicLink()) {
      throw new Error(`safeWrite: 매니페스트가 심볼릭 링크라 쓰지 않음: ${opts.manifestFile}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const manifestResolved = await resolveConfined(opts.manifestFile, rootReal);
  if (!manifestResolved.ok) {
    throw new Error(`safeWrite: 매니페스트 경로가 안전하지 않음(${opts.manifestFile}): ${manifestResolved.reason}`);
  }

  const manifest = await readManifest(manifestResolved.real, opts.tool, opts.version);
  const entries = manifest.entries;
  let manifestChanged = false;

  // 같은 파일에 여러 영역을 쓸 수 있으므로 realpath별 텍스트를 메모리에서 이어 간다.
  const states = new Map<string, FileState>();
  const dirty = new Set<string>();
  const outcomes: WriteOutcome[] = [];

  for (const w of writes) {
    if (w.mode === "create-only" && w.region.kind !== "file") {
      throw new Error(`safeWrite: create-only는 file 영역만 허용함: ${w.file}`);
    }
    const rel = displayPath(w.file, opts.displayRoot, opts.home);
    const key = regionKey(w, opts.manifestFile);
    const adapter = adapterFor(w);
    const base = { file: rel, key, region: w.region.kind } as const;

    const resolved = await resolveConfined(w.file, rootReal);
    if (!resolved.ok) {
      outcomes.push({ ...base, status: "skipped-invalid", reason: resolved.reason });
      continue;
    }
    const real = resolved.real;

    let state = states.get(real);
    if (state === undefined) {
      state = await readState(real);
      states.set(real, state);
    }
    const text = state.text;

    const read = adapter.read(text);
    if (!read.ok) {
      outcomes.push({ ...base, status: "skipped-invalid", reason: read.reason });
      continue;
    }

    const { current } = read;
    const desired = adapter.desired;
    const recorded = Object.hasOwn(entries, key) ? entries[key]?.sha256 : undefined;
    const createOnly = w.mode === "create-only";

    let status: WriteStatus;
    let reason: string | undefined;
    if (createOnly && current !== null) {
      if (current === desired) {
        outcomes.push({ ...base, status: "unchanged" });
      } else {
        outcomes.push({ ...base, status: "skipped-exists", reason: "기존 파일 — 스캐폴드는 새 파일만 씀" });
      }
      continue;
    }
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
      if (recorded !== hash) {
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
    states.set(real, { text: after, bom: state.bom });
    dirty.add(real);
    entries[key] = { sha256: sha256(desired) };
    manifestChanged = true;
    outcomes.push({ ...base, status, ...(opts.dryRun ? { diff: patch(rel, text, after) } : {}) });
  }

  if (!opts.dryRun) {
    for (const real of dirty) {
      const state = states.get(real);
      if (state === undefined || state.text === null) continue;
      await atomicWrite(real, (state.bom ? BOM : "") + state.text);
    }
    if (manifestChanged) {
      const sorted = Object.create(null) as WriteManifest["entries"];
      for (const k of Object.keys(entries).sort()) sorted[k] = entries[k] as { sha256: string };
      const out: WriteManifest = { version: 1, tool: opts.tool, dsmith: opts.version, entries: sorted };
      await atomicWrite(manifestResolved.real, `${JSON.stringify(out, null, 2)}\n`);
    }
  }

  return { outcomes, applied: !opts.dryRun, manifestChanged };
}
