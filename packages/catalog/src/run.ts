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
  const { root, version } = opts;
  const [index, detect] = await Promise.all([readIndex(root), readDetect(root)]);
  if (index === null || detect === null) throw new Error("분석 결과(.dsmith/index.json·detect.json)가 없음 — 먼저 `dsmith audit`");

  const { catalog, warnings } = await buildCatalog({
    root,
    detect,
    index,
    version,
    ...(opts.from === undefined ? {} : { from: opts.from }),
  });

  // 사용 수 순 이름: 인덱스의 name+module 사용 수를 카탈로그 module로 조인
  const counts = new Map<string, number>();
  for (const s of summarizeComponents(index.components)) {
    counts.set(JSON.stringify([s.name, s.module]), s.count);
  }
  const usage = (c: { name: string; module: string }): number => counts.get(JSON.stringify([c.name, c.module])) ?? 0;
  const usageOrder = [...catalog.components]
    .sort((a, b) => usage(b) - usage(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((c) => c.name);

  const section = renderAgentsDsSection(catalog, usageOrder);
  const dryRun = opts.dryRun === true;
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

  const notes: string[] = [];
  const claude = await claudeMdNote(root);
  if (claude !== null) notes.push(claude);
  if (!(await exists(path.join(root, ".dsmith", "install.json")))) notes.push("MCP 서버 미등록 — `npx dsmith install`");
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
  const target = r.dryRun ? `${CATALOG_FILE} (dry-run: 쓰지 않음)` : CATALOG_FILE;
  lines.push(`카탈로그: 컴포넌트 ${r.components} (props 추출 ${rate}) · deprecated ${r.deprecated} · 토큰 ${r.tokens} → ${target}`);
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
