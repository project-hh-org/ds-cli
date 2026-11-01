import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AI_TOOLS,
  TOML_MARKERS,
  defaultMcpLaunch,
  detectTools,
  loadCommands,
  normalizeTools,
  parseMcpCommand,
  renderers,
  type AiTool,
  type McpLaunch,
  type ToolDetection,
} from "@dsmith-dev/agent-skill";
import { regionKey, safeWrite, type PlannedWrite, type WriteOutcome } from "@dsmith-dev/core";
import { cliVersion } from "../version.js";

export interface InstallOptions {
  root: string;
  /** 기본 os.homedir() — 테스트가 주입 */
  home?: string;
  /** --tool (반복 가능). 주면 감지를 건너뛴다 */
  tools?: AiTool[];
  /** --all = AI_TOOLS 전부. --tool보다 우선 */
  all?: boolean;
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
  /** --mcp-command "<cmd> [args…]" (배포 전 로컬 개발용) */
  mcpCommand?: string;
  /** dsmith 버전. 기본은 cli package.json. 테스트가 주입한다 */
  version?: string;
}

export interface InstallResult {
  scope: "repo" | "global";
  tools: AiTool[];
  /** 도구를 어떻게 골랐는지: 감지 / --tool / --all */
  selection: "detected" | "tool" | "all";
  /** --tool/--all이면 null. --global이면 홈 흔적만 담는다 */
  detection: ToolDetection | null;
  mcp: McpLaunch;
  outcomes: WriteOutcome[];
  notes: string[];
  /** 표시용 매니페스트 경로 */
  manifest: string;
  dryRun: boolean;
}

const CODEX_DUPLICATE_REASON = "config.toml에 dsmith가 관리하지 않는 [mcp_servers.dsmith]가 있음";
const CODEX_INLINE_REASON = "config.toml이 mcp_servers를 인라인 테이블로 정의해 [mcp_servers.dsmith]를 추가할 수 없음";

// --- Codex config.toml: dsmith 마커 블록 밖의 [mcp_servers.dsmith] 점검 -------------------------------------------

const KEY_PART = String.raw`(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*')`;
const DOTTED_KEY = String.raw`${KEY_PART}(?:\s*\.\s*${KEY_PART})*`;
const HEADER_RE = new RegExp(String.raw`^\[\[?\s*(${DOTTED_KEY})\s*\]\]?\s*(?:#.*)?$`);
const KEY_RE = new RegExp(String.raw`^(${DOTTED_KEY})\s*=`);

function splitKey(key: string): string[] {
  return [...key.matchAll(new RegExp(KEY_PART, "g"))].map((m) => m[0].replace(/^["']|["']$/g, ""));
}

/** dsmith 마커 블록(시작·끝이 한 쌍일 때)을 지운 줄 목록. 마커가 어긋나면 null — 그때는 safeWrite가 사유를 낸다. */
function withoutManagedBlock(text: string): string[] | null {
  const lines = text.replace(/^﻿/, "").split("\n");
  const is = (line: string, marker: string): boolean => line.replace(/\r$/, "").trim() === marker;
  const starts = lines.flatMap((l, i) => (is(l, TOML_MARKERS.start) ? [i] : []));
  const ends = lines.flatMap((l, i) => (is(l, TOML_MARKERS.end) ? [i] : []));
  if (starts.length === 0 && ends.length === 0) return lines;
  const [s] = starts;
  const [e] = ends;
  if (starts.length !== 1 || ends.length !== 1 || s === undefined || e === undefined || e < s) return null;
  return [...lines.slice(0, s), ...lines.slice(e + 1)];
}

/**
 * 마커 블록 밖에 사용자가 직접 둔 dsmith MCP 설정이 있는가. 있으면 같은 이름의 테이블이 둘이 되어 TOML이 깨진다.
 * 잡는 모양: `[mcp_servers.dsmith]`(따옴표·공백·`[[…]]` 포함), 최상위 `mcp_servers.dsmith.… =`,
 * `[mcp_servers]` 안의 `dsmith… =`, 최상위 인라인 `mcp_servers = {…}`. `[mcp_servers.dsmith.env]` 같은 하위 테이블은 제외.
 * 여러 줄 문자열 안의 줄까지는 구분하지 않는다 — 오탐은 쓰기를 건너뛸 뿐이다.
 */
export function foreignDsmithMcpTable(text: string): "table" | "inline" | null {
  const lines = withoutManagedBlock(text);
  if (lines === null) return null;
  let section: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = HEADER_RE.exec(line);
    if (header !== null) {
      section = splitKey(header[1] as string);
      if (section.length === 2 && section[0] === "mcp_servers" && section[1] === "dsmith") return "table";
      continue;
    }
    if (line.startsWith("[")) {
      section = ["?"]; // 해석할 수 없는 헤더 — 이어지는 키는 남의 테이블로 본다
      continue;
    }
    const key = KEY_RE.exec(line);
    if (key === null) continue;
    if (section.length > 1 || (section.length === 1 && section[0] !== "mcp_servers")) continue;
    const full = [...section, ...splitKey(key[1] as string)];
    if (full[0] === "mcp_servers" && full[1] === "dsmith") return "table";
    if (section.length === 0 && full.length === 1 && full[0] === "mcp_servers") return "inline";
  }
  return null;
}

// --- 도구 결정 ------------------------------------------------------------------------------------------

function validateTools(tools: readonly string[]): AiTool[] {
  for (const t of tools) {
    if (!(AI_TOOLS as readonly string[]).includes(t)) {
      throw new Error(`알 수 없는 AI 도구: ${JSON.stringify(t)} (허용: ${AI_TOOLS.join(", ")})`);
    }
  }
  return tools as AiTool[];
}

/** --global은 홈의 흔적(`~/`로 시작하는 근거)만 센다. 홈에 흔적이 없으면 기본값 claude-code 하나. */
async function detectFor(scope: "repo" | "global", root: string, home: string): Promise<ToolDetection> {
  const full = await detectTools(root, home);
  if (scope === "repo") return full;
  const evidence: ToolDetection["evidence"] = {};
  for (const tool of AI_TOOLS) {
    const homeOnly = (full.evidence[tool] ?? []).filter((label) => label.startsWith("~/"));
    if (homeOnly.length > 0) evidence[tool] = homeOnly;
  }
  const found = Object.keys(evidence) as AiTool[];
  if (found.length === 0) return { tools: ["claude-code"], evidence, defaulted: true };
  return { tools: normalizeTools(found), evidence, defaulted: false };
}

// --- 실행 -----------------------------------------------------------------------------------------------

const launchText = (m: McpLaunch): string => [m.command, ...m.args].join(" ");

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch {
    return null; // 없거나 못 읽는 파일은 safeWrite가 사유를 낸다
  }
}

async function manifestIsReadable(file: string): Promise<boolean> {
  const text = await readText(file);
  if (text === null) return true; // 아직 없음 — 정상
  try {
    const parsed: unknown = JSON.parse(text);
    const entries = (parsed as { entries?: unknown } | null)?.entries;
    return typeof entries === "object" && entries !== null && !Array.isArray(entries);
  } catch {
    return false;
  }
}

function displayPath(file: string, root: string, home: string): string {
  const posix = (p: string): string => p.split(path.sep).join("/");
  for (const [base, prefix] of [[root, ""], [home, "~/"]] as const) {
    const rel = path.relative(base, file);
    if (rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) return `${prefix}${posix(rel)}`;
  }
  return posix(file);
}

export async function runInstall(opts: InstallOptions): Promise<InstallResult> {
  const scope = opts.global === true ? "global" : "repo";
  const root = path.resolve(opts.root);
  const home = path.resolve(opts.home ?? os.homedir());
  const version = opts.version ?? cliVersion();
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;

  // 1. MCP 실행 명령 — 0.0.0(로컬 개발 빌드)이면 npx로 받을 배포판이 없으므로 --mcp-command가 필수
  if (opts.mcpCommand === undefined && version === "0.0.0") {
    throw new Error(
      '로컬 개발 빌드(0.0.0)에는 npx로 받을 배포판이 없습니다. --mcp-command 를 주세요. 예: --mcp-command "node <절대경로>/packages/cli/dist/bin.js"',
    );
  }
  const mcp = opts.mcpCommand !== undefined ? parseMcpCommand(opts.mcpCommand) : defaultMcpLaunch(version);
  const notes: string[] = [];
  if (opts.mcpCommand !== undefined && scope === "repo") {
    notes.push(
      `경고: --mcp-command(${launchText(mcp)})의 경로는 이 컴퓨터에만 있습니다. 레포에 쓰는 설정 파일(.mcp.json 등)을 커밋하면 다른 사람 환경에서 MCP가 뜨지 않습니다. 커밋하지 마세요.`,
    );
  }

  // 2. 도구 결정: --all > --tool > 감지. codex는 agents-md를 함께 설치한다.
  let selection: InstallResult["selection"];
  let detection: ToolDetection | null = null;
  let tools: AiTool[];
  if (opts.all === true) {
    selection = "all";
    tools = normalizeTools([...AI_TOOLS]);
  } else if (opts.tools !== undefined && opts.tools.length > 0) {
    selection = "tool";
    tools = normalizeTools(validateTools(opts.tools));
  } else {
    selection = "detected";
    detection = await detectFor(scope, root, home);
    tools = detection.tools;
  }

  // 3. 전부 렌더한다 — 렌더러 하나라도 실패하면 아무것도 쓰기 전에 중단된다.
  const commands = await loadCommands();
  const planned: PlannedWrite[] = [];
  for (const tool of tools) {
    const out = renderers[tool].render(commands, { root, home, scope, mcp });
    planned.push(...out.writes);
    notes.push(...out.notes);
  }

  const base = scope === "repo" ? root : home;
  const manifestFile = path.join(base, ".dsmith", "install.json");
  const manifestShown = displayPath(manifestFile, root, home);
  if (!(await manifestIsReadable(manifestFile))) {
    notes.push(
      `경고: ${manifestShown}을 읽을 수 없어 비어 있는 것으로 봅니다. 내용이 같은 기존 파일은 그대로 채택하고, 다른 파일은 건너뜁니다(--force로 덮어쓰기).`,
    );
  }

  // 4. Codex config.toml에 dsmith가 관리하지 않는 [mcp_servers.dsmith]가 있으면 쓰지 않는다 — --force로도 넘지 못한다.
  const preSkipped = new Map<PlannedWrite, WriteOutcome>();
  for (const w of planned) {
    if (w.region.kind !== "block" || w.region.start !== TOML_MARKERS.start) continue;
    const text = await readText(w.file);
    const found = text === null ? null : foreignDsmithMcpTable(text);
    if (found === null) continue;
    preSkipped.set(w, {
      file: displayPath(w.file, root, home),
      key: regionKey(w, manifestFile),
      region: "block",
      status: "skipped-invalid",
      reason: found === "inline" ? CODEX_INLINE_REASON : CODEX_DUPLICATE_REASON,
    });
    notes.push(
      `Codex MCP 등록을 건너뜀: ${displayPath(w.file, root, home)}의 기존 dsmith 설정이 \`${launchText(mcp)}\`를 가리키는지 직접 확인하세요.`,
    );
  }

  // 5. 한 번의 safeWrite(매니페스트 하나)
  const writes = planned.filter((w) => !preSkipped.has(w));
  const written =
    writes.length === 0
      ? []
      : (
          await safeWrite(writes, {
            manifestFile,
            displayRoot: root,
            confineTo: base,
            home,
            dryRun,
            force,
            tool: "install",
            version,
          })
        ).outcomes;
  const queue = [...written];
  const outcomes = planned.map((w) => preSkipped.get(w) ?? (queue.shift() as WriteOutcome));

  return {
    scope,
    tools,
    selection,
    detection,
    mcp,
    outcomes,
    notes: [...new Set(notes)],
    manifest: manifestShown,
    dryRun,
  };
}

// --- 출력 -----------------------------------------------------------------------------------------------

function toolLabel(tool: AiTool, r: InstallResult): string {
  const labels = r.detection?.evidence[tool] ?? [];
  const repo = labels.filter((l) => !l.startsWith("~/"));
  const home = labels.filter((l) => l.startsWith("~/"));
  const parts = [...(repo.length > 0 ? [`레포: ${repo.join(", ")}`] : []), ...(home.length > 0 ? [`홈: ${home.join(", ")}`] : [])];
  if (parts.length === 0 && tool === "agents-md" && r.detection !== null && !r.detection.defaulted && r.tools.includes("codex")) {
    parts.push("codex와 함께");
  }
  return parts.length === 0 ? tool : `${tool} (${parts.join("; ")})`;
}

function registeredLine(r: InstallResult): string {
  if (r.selection === "all") return `등록: ${r.tools.join(", ")} (--all)`;
  if (r.selection === "tool") {
    const paired = r.tools.includes("codex") && r.tools.includes("agents-md") ? ", agents-md는 codex와 함께" : "";
    return `등록: ${r.tools.join(", ")} (--tool 지정${paired})`;
  }
  if (r.detection?.defaulted === true) {
    return `등록: ${r.tools.join(", ")} (감지: ${r.scope === "global" ? "홈에 " : ""}흔적 없음 → 기본값)`;
  }
  return `등록: ${r.tools.map((t) => toolLabel(t, r)).join(", ")}`;
}

/** 사람이 읽는 요약. 등록한 도구와 근거, 파일 개수, 건너뜀 사유, 할 일, 다음 단계. */
export function formatInstallSummary(r: InstallResult): string {
  const count = (...statuses: WriteOutcome["status"][]): number => r.outcomes.filter((o) => statuses.includes(o.status)).length;
  const skipped = r.outcomes.filter((o) => o.status.startsWith("skipped"));
  const lines: string[] = [];
  if (r.dryRun) lines.push("(dry-run — 아무것도 쓰지 않음)");
  lines.push(
    registeredLine(r),
    `파일: 생성 ${count("created")} · 변경 ${count("updated")} · 유지 ${count("unchanged")} · 건너뜀 ${skipped.length}`,
  );
  for (const o of skipped) lines.push(`건너뜀: ${o.file} — ${o.reason ?? o.status}`);
  if (skipped.some((o) => o.status === "skipped-modified" || o.status === "skipped-unowned")) {
    lines.push("건너뛴 파일은 --force로 덮어쓰기");
  }
  if (r.dryRun) {
    for (const o of r.outcomes) if (o.diff !== undefined && o.diff !== "") lines.push("", o.diff.trimEnd());
  }
  const notes = [...new Set(r.notes)];
  if (notes.length > 0) lines.push("", "할 일:", ...notes.map((n) => `- ${n}`), "");
  lines.push(r.dryRun ? "다음: --dry-run 없이 다시 실행하면 위 내용을 씁니다" : "다음: AI 도구를 다시 열고 /ds 로 시작");
  return lines.join("\n");
}
