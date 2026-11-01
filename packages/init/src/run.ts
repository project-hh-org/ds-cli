import fs from "node:fs/promises";
import path from "node:path";
import {
  atomicWrite,
  buildTokenDraft,
  decisionCandidates,
  draftCoverage,
  draftToTokens,
  emitTokensCss,
  emitTokensTs,
  explainDecision,
  listDecisions,
  localDate,
  readComponentProps,
  readDecisions,
  readIndex,
  regionKey,
  safeWrite,
  seedDecisions,
  serializeW3c,
  summarizeComponents,
  writeDecisions,
  type ComponentProps,
  type Coverage,
  type DecisionKind,
  type PlannedWrite,
  type ScaleMapping,
  type StyleUsage,
  type TokenDraft,
  type WriteOutcome,
  type WriteStatus,
} from "@dsmith-dev/core";
import { isDsSpecifier, readDetect } from "@dsmith-dev/detect";
import { normalizeOutDir } from "./out-dir.js";
import { renderInitReport } from "./report.js";
import { renderScaffold, type ScaffoldProp } from "./scaffold.js";

export interface InitOptions {
  root: string;
  outDir?: string;
  /** 결정 없이 추천안으로 스캐폴드 상위 top개 */
  all?: boolean;
  /** 기본 10 */
  top?: number;
  dryRun?: boolean;
  /** 토큰 파일만 영향(스캐폴드는 create-only) */
  force?: boolean;
  /** 매니페스트 기록 */
  version: string;
  /** 리포트 파일명 날짜(테스트 주입) */
  now?: Date;
}

export interface InitScaffold {
  item: string;
  name: string;
  file: string;
  from: string;
  basis: "decided" | "recommended";
  status: WriteStatus;
}

export interface AlphaColor {
  raw: string;
  hex: string;
  count: number;
}

export interface InitResult {
  outDir: string;
  /** mergedValues = Σ members.length */
  tokens: { color: number; spacing: number; radius: number; fontSize: number; total: number; mergedValues: number };
  coverage: Coverage;
  mappings: ScaleMapping[];
  scaffolds: InitScaffold[];
  skippedScaffolds: { item: string; reason: string }[];
  decisions: { added: number; pending: number; decided: number; stale: number };
  /** 알파 채널이 있어 토큰 값(6자리 hex)에서 알파가 빠진 하드코딩 색 */
  alphaDropped: AlphaColor[];
  outcomes: WriteOutcome[];
  /** ".dsmith/reports/init-<date>.md", dryRun이면 null */
  report: string | null;
  /** ".dsmith/init.json" */
  manifest: string;
  dryRun: boolean;
}

const NEED_AUDIT = "먼저 `dsmith audit`을 실행하세요";
const MANIFEST = ".dsmith/init.json";
const DEFAULT_TOP = 10;
const TOP_USES = 3;
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;

interface Target {
  item: string;
  kind: "duplicate" | "local-definition";
  basis: "decided" | "recommended";
}

/** 하드코딩 색 중 알파가 1 미만인 것(raw 기준 집계). 토큰은 6자리 hex라 알파가 빠진다. */
function alphaOf(raw: string): number | null {
  const v = raw.trim();
  const hex = /^#(?:[0-9a-f]{3}([0-9a-f])|[0-9a-f]{6}([0-9a-f]{2}))$/i.exec(v);
  if (hex !== null) {
    const digits = hex[1] ?? hex[2] ?? "f";
    return Number.parseInt(digits.length === 1 ? digits + digits : digits, 16) / 255;
  }
  const slash = /^[a-z-]+\(.*\/\s*([\d.]+)(%?)\s*\)$/i.exec(v);
  if (slash !== null) return Number(slash[1]) / (slash[2] === "%" ? 100 : 1);
  const legacy = /^(?:rgba|hsla)\(([^)]*)\)$/i.exec(v);
  if (legacy !== null) {
    const parts = (legacy[1] ?? "").split(",");
    if (parts.length === 4) {
      const last = (parts[3] ?? "").trim();
      return last.endsWith("%") ? Number.parseFloat(last) / 100 : Number(last);
    }
  }
  return null;
}

function alphaDropped(styles: StyleUsage[], outDir: string): AlphaColor[] {
  const found = new Map<string, AlphaColor>();
  for (const u of styles) {
    if (u.source !== "hardcoded" || u.normalized.kind !== "color") continue;
    if (u.file === outDir || u.file.startsWith(`${outDir}/`)) continue;
    const alpha = alphaOf(u.raw);
    if (alpha === null || !(alpha < 1)) continue;
    const entry = found.get(u.raw) ?? { raw: u.raw, hex: u.normalized.hex, count: 0 };
    entry.count += 1;
    found.set(u.raw, entry);
  }
  return [...found.values()].sort((a, b) => b.count - a.count || (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0));
}

const byCountThenFile = (a: { file: string; count: number }, b: { file: string; count: number }): number =>
  b.count - a.count || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

export async function runInit(opts: InitOptions): Promise<InitResult> {
  const root = path.resolve(opts.root);
  const index = await readIndex(root);
  const detected = await readDetect(root);
  if (index === null || detected === null) throw new Error(NEED_AUDIT);
  const outDir = normalizeOutDir(root, opts.outDir);
  const dryRun = opts.dryRun === true;
  const isDsModule = (m: string): boolean => isDsSpecifier(m, detected.ds);

  // 2. 결정 읽기 → token-cluster 선택
  const decisions = await readDecisions(root);
  const colorChoices: Record<string, string> = {};
  for (const r of decisions.items) {
    if (r.kind === "token-cluster" && r.status === "decided" && r.chosen !== undefined) colorChoices[r.item] = r.chosen;
  }

  // 3. 토큰 초안
  const draft: TokenDraft = buildTokenDraft(index.styles, { excludeDirs: [outDir], colorChoices });

  // 4. pending 결정 시드
  const seed = seedDecisions(
    decisions,
    index,
    draft.tokens
      .filter((t) => t.category === "color" && t.members.length >= 2)
      .map((t) => ({ item: t.key, options: t.members })),
  );

  // 5. 스캐폴드 대상
  const listed = listDecisions(index, seed.file);
  const decidedOf = (item: string, kind: DecisionKind): boolean =>
    listed.some((l) => l.item === item && l.kind === kind && l.status === "decided" && l.stale !== true);
  const targets: Target[] = [];
  if (opts.all === true) {
    const top = opts.top ?? DEFAULT_TOP;
    for (const c of decisionCandidates(index).slice(0, top)) {
      if (c.kind === "token-cluster") continue;
      targets.push({ item: c.item, kind: c.kind, basis: decidedOf(c.item, c.kind) ? "decided" : "recommended" });
    }
  } else {
    for (const l of listed) {
      if (l.kind === "token-cluster" || l.status !== "decided" || l.stale === true) continue;
      targets.push({ item: l.item, kind: l.kind, basis: "decided" });
    }
  }

  const summaries = summarizeComponents(index.components);
  const planned = new Map<string, PlannedWrite>();
  const scaffolds: Omit<InitScaffold, "status">[] = [];
  const skippedScaffolds: InitResult["skippedScaffolds"] = [];
  const tokensRef = `${outDir}/tokens.css`;

  for (const target of targets) {
    const name = target.item;
    if (!COMPONENT_NAME.test(name)) {
      skippedScaffolds.push({ item: name, reason: "파일 이름으로 쓸 수 없는 컴포넌트 이름" });
      continue;
    }
    const explained = await explainDecision(root, index, name, {
      isDsModule,
      decisions: seed.file,
      git: false,
      kind: target.kind,
    });
    if ("error" in explained) {
      skippedScaffolds.push({ item: name, reason: explained.error === "not-found" ? explained.message : "종류가 모호함" });
      continue;
    }
    const { card } = explained;
    const decidedChosen = card.decided?.chosen;
    const decidedValid = decidedChosen !== undefined && card.options.some((o) => o.id === decidedChosen);
    const chosenId = decidedValid ? decidedChosen : card.recommendation.optionId;
    const basis: Target["basis"] = decidedValid ? "decided" : target.basis === "decided" ? "decided" : "recommended";
    const option = card.options.find((o) => o.id === chosenId);
    if (option === undefined) {
      skippedScaffolds.push({ item: name, reason: "고른 옵션을 카드에서 찾지 못함" });
      continue;
    }
    if (option.isDs) {
      skippedScaffolds.push({ item: name, reason: `이미 DS에 있음: ${option.module ?? option.id}` });
      continue;
    }
    const file = `${outDir}/components/${name}.tsx`;
    if (planned.has(file)) {
      skippedScaffolds.push({ item: name, reason: `이름 충돌: ${file}` });
      continue;
    }

    // props: 사용처 합집합 ∪ 정의 파일(타입·required·values는 정의 파일 우선)
    const props = new Map<string, ScaffoldProp>();
    const sameName = summaries.filter((s) => s.name === name);
    for (const s of sameName) for (const p of s.props) props.set(p, { name: p });
    if (option.file !== undefined) {
      let defined: ComponentProps | null = null;
      try {
        defined = readComponentProps(await fs.readFile(path.join(root, option.file), "utf-8"), option.file, name);
      } catch {
        defined = null;
      }
      for (const p of defined?.props ?? []) {
        props.set(p.name, {
          name: p.name,
          ...(p.type === undefined ? {} : { type: p.type }),
          ...(p.required === undefined ? {} : { required: p.required }),
          ...(p.values === undefined ? {} : { values: p.values }),
        });
      }
    }
    const usesByFile = new Map<string, number>();
    for (const s of sameName) for (const f of s.files) usesByFile.set(f.file, (usesByFile.get(f.file) ?? 0) + f.count);
    const topUses = [...usesByFile.entries()]
      .map(([f, count]) => ({ file: f, count }))
      .sort(byCountThenFile)
      .slice(0, TOP_USES);

    planned.set(file, {
      file: path.join(root, file),
      region: { kind: "file" },
      mode: "create-only",
      content: renderScaffold({ name, item: name, basis, from: chosenId, props: [...props.values()], topUses, tokensRef }),
    });
    scaffolds.push({ item: name, name, file, from: chosenId, basis });
  }

  // 6. 쓰기. 토큰 3종은 managed, 스캐폴드는 create-only.
  const manifestFile = path.join(root, MANIFEST);
  const tokenWrite = (name: string, content: string): PlannedWrite => ({
    file: path.join(root, outDir, name),
    region: { kind: "file" },
    content,
  });
  const jsonWrite = tokenWrite("tokens.json", serializeW3c(draft));
  const cssWrite = tokenWrite("tokens.css", emitTokensCss(draft));
  const tsWrite = tokenWrite("tokens.ts", emitTokensTs(draft));
  const safeOpts = {
    manifestFile,
    displayRoot: root,
    confineTo: root,
    force: opts.force === true,
    tool: "init",
    version: opts.version,
  };

  // json과 css는 한 쌍이다: 둘 중 하나가 막히면(사용자 수정 등) 다른 하나도 쓰지 않아 어긋나지 않게 한다.
  const preflight = await safeWrite([jsonWrite, cssWrite], { ...safeOpts, dryRun: true });
  const blocked = preflight.outcomes.some((o) => o.status.startsWith("skipped"));
  const pairBlocked = new Map<string, WriteOutcome>();
  if (blocked) {
    for (const [w, o] of [jsonWrite, cssWrite].map((w, i) => [w, preflight.outcomes[i] as WriteOutcome] as const)) {
      pairBlocked.set(w.file, o.status === "created" || o.status === "updated"
        ? {
            file: o.file,
            key: o.key,
            region: o.region,
            status: "skipped-modified",
            reason: "tokens.json·tokens.css는 함께 써야 함 — 짝 파일이 사용자 수정으로 막힘, 덮어쓰려면 --force",
          }
        : o);
    }
  }
  const toWrite: PlannedWrite[] = [
    ...(blocked ? [] : [jsonWrite, cssWrite]),
    tsWrite,
    ...planned.values(),
  ];
  const written = await safeWrite(toWrite, { ...safeOpts, dryRun });
  const outcomeOf = new Map<string, WriteOutcome>();
  toWrite.forEach((w, i) => outcomeOf.set(w.file, written.outcomes[i] as WriteOutcome));
  for (const [file, o] of pairBlocked) outcomeOf.set(file, o);
  const outcomes = [jsonWrite, cssWrite, tsWrite, ...planned.values()].map((w) => outcomeOf.get(w.file) as WriteOutcome);

  // 7. 커버리지
  const coverage = draftCoverage(index.styles, draftToTokens(draft), { excludeDirs: [outDir] });

  // 9. 결정 요약
  const after = listDecisions(index, seed.file);
  const decisionSummary = {
    added: seed.added.length,
    pending: after.filter((i) => i.status === "pending").length,
    decided: after.filter((i) => i.status === "decided").length,
    stale: after.filter((i) => i.stale === true).length,
  };

  const statusOfFile = new Map(outcomes.map((o, i) => [i, o.status] as const));
  const scaffoldResults: InitScaffold[] = scaffolds.map((s, i) => ({
    ...s,
    status: statusOfFile.get(3 + i) as WriteStatus,
  }));

  const count = (category: string): number => draft.tokens.filter((t) => t.category === category).length;
  const result: InitResult = {
    outDir,
    tokens: {
      color: count("color"),
      spacing: count("spacing"),
      radius: count("radius"),
      fontSize: count("font-size"),
      total: draft.tokens.length,
      mergedValues: draft.tokens.reduce((n, t) => n + t.members.length, 0),
    },
    coverage,
    mappings: draft.mappings,
    scaffolds: scaffoldResults,
    skippedScaffolds,
    decisions: decisionSummary,
    alphaDropped: alphaDropped(index.styles, outDir),
    outcomes,
    report: null,
    manifest: MANIFEST,
    dryRun,
  };

  // 8. dryRun이 아니면 결정 시드와 리포트를 쓴다(.dsmith 안은 atomicWrite).
  if (!dryRun) {
    if (seed.added.length > 0) await writeDecisions(root, seed.file);
    const report = `.dsmith/reports/init-${localDate(opts.now ?? new Date())}.md`;
    await atomicWrite(path.join(root, report), renderInitReport(result, draft));
    result.report = report;
  }
  return result;
}

export function formatInitSummary(r: InitResult): string {
  const t = r.tokens;
  const c = r.coverage;
  const lines: string[] = [];
  if (r.dryRun) lines.push("(dry-run — 아무것도 쓰지 않았습니다)");
  lines.push(
    `토큰: 색 ${t.color} · 간격 ${t.spacing} · 모서리 ${t.radius} · 글꼴 크기 ${t.fontSize} (병합된 원값 ${t.mergedValues}) → ${r.outDir}/tokens.{json,css,ts}`,
  );
  const rate = c.rate === null ? "해당 없음" : `${(c.rate * 100).toFixed(1)}%`;
  lines.push(
    c.total === 0
      ? "커버리지: 하드코딩 값이 없음 (migrate 예상치)"
      : `커버리지: 하드코딩 ${c.total}건 중 ${c.replaceable}건(${rate})을 토큰으로 바꿀 수 있음 (migrate 예상치)`,
  );
  if (r.alphaDropped.length > 0) {
    lines.push(`알파 제외: 투명도가 있는 색 ${r.alphaDropped.length}종은 토큰 값에서 알파가 빠짐 (리포트 참고)`);
  }
  const created = r.scaffolds.filter((s) => s.status === "created").length;
  const kept = r.scaffolds.filter((s) => s.status === "unchanged" || s.status === "skipped-exists").length;
  const skipped = r.skippedScaffolds.length;
  const skippedDetail =
    skipped === 0 ? "" : ` (${r.skippedScaffolds.map((s) => `${s.item} — ${s.reason}`).join("; ")})`;
  lines.push(`스캐폴드: 생성 ${created} · 유지 ${kept} · 건너뜀 ${skipped}${skippedDetail}`);
  const stale = r.decisions.stale > 0 ? `, stale ${r.decisions.stale}건` : "";
  lines.push(`결정: pending ${r.decisions.pending}건${stale} — /ds-decide 로 고르거나 --all 로 추천안 사용`);
  const blockedToken = r.outcomes
    .slice(0, 3)
    .some((o) => o.status === "skipped-modified" || o.status === "skipped-unowned");
  if (blockedToken) lines.push("사람이 고친 토큰 파일 — 덮어쓰려면 --force");
  if (r.report !== null) lines.push(`리포트: ${r.report}`);
  if (r.dryRun) {
    for (const o of r.outcomes) {
      lines.push(`쓸 예정: ${o.file} (${o.status})`);
      if (o.diff !== undefined) lines.push(o.diff.trimEnd());
    }
  }
  return lines.join("\n");
}
