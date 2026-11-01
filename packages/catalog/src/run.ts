import fs from "node:fs/promises";
import path from "node:path";
import {
  readIndex,
  safeWrite,
  summarizeComponents,
  writeCatalog,
  CATALOG_FILE,
  type CatalogSource,
  type WriteOutcome,
} from "@dsmith-dev/core";
import { readDetect } from "@dsmith-dev/detect";
import { DS_MARKERS, renderAgentsDsSection } from "./agents-section.js";
import { buildCatalog } from "./build.js";

export interface AiOptions {
  root: string;
  from?: "auto" | "ds" | "init";
  dryRun?: boolean;
  force?: boolean;
  version: string;
}

export interface AiResult {
  sources: CatalogSource[];
  components: number;
  propsExtracted: { ok: number; total: number; rate: number | null };
  deprecated: number;
  tokens: number;
  /** ".dsmith/catalog.json", dryRun이면 null */
  catalogFile: string | null;
  /** 기존 catalog.json과 바이트가 달랐나 */
  catalogChanged: boolean;
  /** AGENTS.md 블록 1건 */
  outcomes: WriteOutcome[];
  notes: string[];
  warnings: string[];
  manifest: string;
  dryRun: boolean;
}

const MANIFEST = ".dsmith/ai.json";

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** AI 도구별 MCP 설정 파일에 dsmith 서버 항목이 있는지. install.json이 없어도(수동 등록) 인정한다. */
async function mcpRegistered(root: string): Promise<boolean> {
  if (await exists(path.join(root, ".dsmith", "install.json"))) return true;
  for (const rel of [".mcp.json", ".cursor/mcp.json", ".gemini/settings.json"]) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(root, rel), "utf-8")) as { mcpServers?: Record<string, unknown> };
      if (parsed.mcpServers !== undefined && Object.hasOwn(parsed.mcpServers, "dsmith")) return true;
    } catch {
      // 없거나 JSON이 아님 — 다음 파일
    }
  }
  try {
    const toml = await fs.readFile(path.join(root, ".codex", "config.toml"), "utf-8");
    if (/^\s*\[\s*mcp_servers\s*\.\s*"?dsmith"?\s*\]/m.test(toml)) return true;
  } catch {
    // 없음
  }
  return false;
}

async function claudeMdNote(root: string): Promise<string | null> {
  for (const rel of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
    let text: string;
    try {
      text = await fs.readFile(path.join(root, rel), "utf-8");
    } catch {
      continue;
    }
    if (!text.includes("@AGENTS.md")) {
      return `Claude Code는 CLAUDE.md가 있으면 AGENTS.md를 읽지 않음 — ${rel}에 \`@AGENTS.md\` 한 줄을 추가하세요`;
    }
    return null;
  }
  return null;
}

export async function runAi(opts: AiOptions): Promise<AiResult> {
  const root = path.resolve(opts.root);
  const { version } = opts;
  const [index, detect] = await Promise.all([readIndex(root), readDetect(root)]);
  if (index === null || detect === null) throw new Error("분석 결과(.dsmith/index.json·detect.json)가 없음 — 먼저 `dsmith audit`");

  const { catalog, warnings } = await buildCatalog({
    root,
    detect,
    index,
    version,
    ...(opts.from === undefined ? {} : { from: opts.from }),
  });

  // 사용 수 순 이름: 인덱스의 name+module 사용 수를 카탈로그 module로 조인.
  // init 산출 컴포넌트는 module이 init 디렉터리라 조인이 0이 되므로 이름만으로 센 사용 수로 대체한다.
  const counts = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  for (const s of summarizeComponents(index.components)) {
    counts.set(JSON.stringify([s.name, s.module]), s.count);
    nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + s.count);
  }
  const usage = (c: { name: string; module: string }): number =>
    counts.get(JSON.stringify([c.name, c.module])) || (nameCounts.get(c.name) ?? 0);
  const usageOrder = [...catalog.components]
    .sort((a, b) => usage(b) - usage(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((c) => c.name);

  const dryRun = opts.dryRun === true;
  const notes: string[] = [];

  // 컴포넌트가 하나도 없으면 비어 있는 카탈로그·섹션으로 기존 것을 덮어쓰지 않는다:
  // `--from init`인데 init 컴포넌트가 없을 때, npm DS의 타입을 못 읽었을 때(node_modules 없음 등).
  const npmEmpty = catalog.components.length === 0 && catalog.sources.some((s) => s.origin === "ds-npm");
  if ((opts.from === "init" && catalog.components.length === 0) || npmEmpty) {
    if (npmEmpty) {
      warnings.push("npm DS의 컴포넌트를 읽지 못함 — 카탈로그와 AGENTS.md DS 섹션을 갱신하지 않음");
      notes.push("의존성을 설치(node_modules에 DS 패키지가 있게)한 뒤 다시 실행");
    } else {
      warnings.push("init 컴포넌트가 없음 — 카탈로그와 AGENTS.md DS 섹션을 갱신하지 않음");
      notes.push("`dsmith init --all`(또는 /ds-decide로 결정 후 `dsmith init`)으로 스캐폴드를 만든 뒤 다시 실행");
    }
    return {
      sources: catalog.sources,
      components: 0,
      propsExtracted: { ok: 0, total: 0, rate: null },
      deprecated: 0,
      tokens: catalog.stats.tokens,
      catalogFile: null,
      catalogChanged: false,
      outcomes: [],
      notes,
      warnings,
      manifest: MANIFEST,
      dryRun,
    };
  }

  const section = renderAgentsDsSection(catalog, usageOrder);
  const write = await safeWrite(
    [{ file: path.join(root, "AGENTS.md"), region: { kind: "block", ...DS_MARKERS }, content: section }],
    {
      manifestFile: path.join(root, ".dsmith", "ai.json"),
      displayRoot: root,
      confineTo: root,
      dryRun,
      ...(opts.force === true ? { force: true } : {}),
      tool: "ai",
      version,
    },
  );

  // 카탈로그: 내용이 같으면 쓰지 않는다(mtime 보존 — MCP 재로드 방지)
  const before = await fs.readFile(path.join(root, ...CATALOG_FILE.split("/")), "utf-8").catch(() => null);
  const catalogChanged = before !== `${JSON.stringify(catalog, null, 2)}\n`;
  if (!dryRun && catalogChanged) await writeCatalog(root, catalog);

  const claude = await claudeMdNote(root);
  if (claude !== null) notes.push(claude);
  if (!(await mcpRegistered(root))) notes.push("MCP 서버 미등록 — `npx dsmith install`");
  const total = catalog.stats.components;
  if (total > 0 && total - catalog.stats.propsOk > total / 2) {
    notes.push("props를 못 읽은 컴포넌트가 많음 — 타입 정의 위치를 확인");
  }

  return {
    sources: catalog.sources,
    components: total,
    propsExtracted: {
      ok: catalog.stats.propsOk,
      total,
      rate: total === 0 ? null : Math.round((catalog.stats.propsOk / total) * 10000) / 10000,
    },
    deprecated: catalog.stats.deprecated,
    tokens: catalog.stats.tokens,
    catalogFile: dryRun ? null : CATALOG_FILE,
    catalogChanged,
    outcomes: write.outcomes,
    notes,
    warnings,
    manifest: MANIFEST,
    dryRun,
  };
}

const STATUS_LABEL: Record<WriteOutcome["status"], string> = {
  created: "생성",
  updated: "갱신",
  unchanged: "유지",
  "skipped-modified": "건너뜀",
  "skipped-unowned": "건너뜀",
  "skipped-invalid": "건너뜀",
  "skipped-exists": "건너뜀",
};

export function formatAiSummary(r: AiResult): string {
  const rate = r.propsExtracted.rate === null ? "-" : `${Math.round(r.propsExtracted.rate * 100)}%`;
  const lines: string[] = [];
  // 쓰지 않은 실행(dry-run, 컴포넌트가 없어 거절한 경우)은 '→ 파일'로 적지 않는다.
  const dest = r.dryRun ? ` → ${CATALOG_FILE} (dry-run: 쓰지 않음)` : r.catalogFile === null ? " (쓰지 않음)" : ` → ${CATALOG_FILE}`;
  lines.push(`카탈로그: 컴포넌트 ${r.components} (props 추출 ${rate}) · deprecated ${r.deprecated} · 토큰 ${r.tokens}${dest}`);
  for (const o of r.outcomes) {
    const label = STATUS_LABEL[o.status];
    const reason = o.reason === undefined ? "" : `(${o.reason})`;
    const dry = r.dryRun && (o.status === "created" || o.status === "updated") ? " [쓸 예정]" : "";
    lines.push(`${o.file}: DS 섹션 ${label}${o.status.startsWith("skipped") ? reason : ""}${dry}`);
    if (o.diff !== undefined) lines.push(o.diff.trimEnd());
  }
  for (const w of r.warnings) lines.push(`경고: ${w}`);
  if (r.notes.length > 0) {
    lines.push("할 일:");
    for (const n of r.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}
