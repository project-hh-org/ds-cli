import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { summarizeComponents, type ComponentSummary } from "../component/summary.js";
import type { Index } from "../index/indexer.js";
import type { ComponentUsage } from "../model/component-usage.js";
import { isRatedUsage } from "../model/style-usage.js";
import { rankTokens } from "../match/token-matcher.js";
import type { Token } from "../model/token.js";
import { tokenCategoryOf } from "../tokens/load.js";
import type { DecisionCandidate } from "./candidates.js";
import type {
  DecisionCard,
  DecisionOption,
  DecisionRecord,
  DifferenceAspect,
  GitHistory,
} from "./model.js";

export interface CardInput {
  candidate: DecisionCandidate;
  index: Index;
  isDsModule: (module: string) => boolean;
  /** option id → 정의 파일 */
  definitionFiles: Record<string, string | null>;
  /** 정의 파일 → 이력 (없는 키는 생략) */
  history: Record<string, GitHistory>;
  record?: DecisionRecord;
  /** 카드에 싣는 옵션 상한(사용 수 상위 N + 추천 옵션). 없으면 자르지 않는다. 추천·impact는 항상 전체 옵션 기준이다. */
  maxOptions?: number;
  /** 정의 파일 → 그 파일의 다른 컴포넌트 선언 줄 범위(제외할 범위, 1-based 포함). 키가 없거나 비었으면 파일 전체 */
  excludeRanges?: Record<string, { startLine: number; endLine: number }[]>;
  /** 매칭할 토큰(proposal 제외). 비었거나 없으면 tokenMatchRate를 만들지 않는다 */
  tokens?: Token[];
}

const TOP_FILES = 5;
const STYLE_VALUE_LIMIT = 10;

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function stripExtension(file: string): string {
  return file.replace(/\.[^./]+$/, "");
}

interface Built {
  option: DecisionOption;
  /** impact 계산용 전체 사용 파일 */
  allFiles: string[];
  tokenRate: number | null;
  /** tokens가 있을 때만 의미 있다 */
  matchRate: number | null;
  /** 이 옵션의 정의 파일에서 실제로 범위를 좁혔는가 */
  narrowed: boolean;
}

function ratedStylesByFile(styles: StyleUsage[]): Map<string, StyleUsage[]> {
  const byFile = new Map<string, StyleUsage[]>();
  for (const u of styles) {
    if (!isRatedUsage(u)) continue;
    const list = byFile.get(u.file) ?? [];
    list.push(u);
    byFile.set(u.file, list);
  }
  return byFile;
}

function styleValuesOf(rated: StyleUsage[]): DecisionOption["styleValues"] {
  const colors = new Set<string>();
  const spacing = new Set<number>();
  for (const u of rated) {
    if (u.source !== "hardcoded") continue;
    if (u.normalized.kind === "color") colors.add(u.normalized.hex);
    else if (u.normalized.kind === "length" && tokenCategoryOf(u.property) === "spacing") spacing.add(u.normalized.px);
  }
  return {
    color: [...colors].sort(byCodeUnit).slice(0, STYLE_VALUE_LIMIT),
    spacing: [...spacing].sort((a, b) => a - b).slice(0, STYLE_VALUE_LIMIT),
  };
}

/** 토큰 소스 사용 비율. 분모는 rated 중 tailwind-default(기본 스케일)를 뺀 것이다. */
function tokenUsageRateOf(rated: StyleUsage[]): number | null {
  const eligible = rated.filter((u) => u.source !== "tailwind-default");
  if (eligible.length === 0) return null;
  return round4(eligible.filter((u) => u.source === "token").length / eligible.length);
}

/**
 * 토큰 일치율: hardcoded rated 스타일(토큰 카테고리가 있는 속성) 중 가장 가까운 토큰이 exact|close인 비율.
 * 같은 카테고리에 토큰이 없으면 일치하지 않은 것으로 센다. 대상이 0이면 null.
 */
function tokenMatchRateOf(rated: StyleUsage[], tokens: Token[]): number | null {
  let total = 0;
  let matched = 0;
  for (const u of rated) {
    if (u.source !== "hardcoded") continue;
    const category = tokenCategoryOf(u.property);
    if (category === null) continue;
    total++;
    const best = rankTokens(u.normalized, tokens, { category, limit: 1 })[0];
    if (best && best.confidence !== "far") matched++;
  }
  return total === 0 ? null : round4(matched / total);
}

function inRanges(line: number, ranges: { startLine: number; endLine: number }[]): boolean {
  return ranges.some((r) => line >= r.startLine && line <= r.endLine);
}

/** 옵션 하나를 만들 때 쓰는, 후보 전체에 공통인 조회 표 */
interface Lookup {
  summaries: ComponentSummary[];
  /** local-definition: 정의 파일 → 그 파일 안의 import 없는 같은 이름 사용 */
  localUses: Map<string, ComponentUsage[]>;
  rated: Map<string, StyleUsage[]>;
}

function buildOption(input: CardInput, id: string, lookup: Lookup): Built {
  const { candidate } = input;
  const isLocal = candidate.kind === "local-definition";

  let usageCount: number;
  let allFiles: string[];
  let props: string[];
  let file: string | null;
  let isDs: boolean;
  if (isLocal) {
    const uses = lookup.localUses.get(id) ?? [];
    usageCount = uses.length;
    allFiles = usageCount > 0 ? [id] : [];
    props = [...new Set(uses.flatMap((c) => c.props))].sort(byCodeUnit);
    file = id;
    isDs = input.isDsModule(stripExtension(id));
  } else {
    const summary = lookup.summaries.find((s) => s.module === id);
    usageCount = summary?.count ?? 0;
    allFiles = summary?.files.map((f) => f.file) ?? [];
    props = summary?.props ?? [];
    file = input.definitionFiles[id] ?? null;
    isDs = input.isDsModule(id);
  }

  const excluded = file === null ? [] : (input.excludeRanges?.[file] ?? []);
  const fileStyles = file === null ? [] : (lookup.rated.get(file) ?? []);
  const definitionStyles = excluded.length === 0 ? fileStyles : fileStyles.filter((u) => !inRanges(u.line, excluded));
  const option: DecisionOption = {
    id,
    label: id,
    usageCount,
    files: allFiles.slice(0, TOP_FILES),
    props,
    styleValues: styleValuesOf(definitionStyles),
    isDs,
  };
  if (!isLocal) option.module = id;
  if (file !== null) option.file = file;
  return {
    option,
    allFiles,
    tokenRate: tokenUsageRateOf(definitionStyles),
    matchRate: input.tokens && input.tokens.length > 0 ? tokenMatchRateOf(definitionStyles, input.tokens) : null,
    narrowed: excluded.length > 0,
  };
}

/** 값이 정확히 한 옵션에만 있는 것만 옵션별로 모은다. 하나도 없으면 null(그 aspect는 차이가 아니다). */
function exclusiveValues(byOption: Map<string, string[]>): Record<string, string[]> | null {
  const holders = new Map<string, number>();
  for (const values of byOption.values()) {
    for (const v of new Set(values)) holders.set(v, (holders.get(v) ?? 0) + 1);
  }
  const result: Record<string, string[]> = {};
  let any = false;
  for (const [id, values] of byOption) {
    const only = values.filter((v) => holders.get(v) === 1);
    if (only.length > 0) {
      result[id] = only;
      any = true;
    }
  }
  return any ? result : null;
}

function differencesOf(kind: DecisionCard["kind"], built: Built[]): DecisionCard["differences"] {
  const differences: DecisionCard["differences"] = [];
  const add = (aspect: DifferenceAspect, values: (b: Built) => string[]): void => {
    const exclusive = exclusiveValues(new Map(built.map((b) => [b.option.id, values(b)])));
    if (exclusive) differences.push({ aspect, byOption: exclusive });
  };
  if (kind === "duplicate") add("module", (b) => (b.option.module === undefined ? [] : [b.option.module]));
  add("props", (b) => b.option.props);
  add("color", (b) => b.option.styleValues.color);
  add("spacing", (b) => b.option.styleValues.spacing.map((px) => `${px}px`));
  return differences;
}

/** 옵션 X를 고르면 바꿔야 하는 것 = X를 뺀 나머지 전체 옵션의 호출 수와 파일 수(상한으로 잘린 옵션도 센다). */
function impactOf(built: Built[], kept: Built[]): DecisionCard["impact"] {
  const totalCalls = built.reduce((n, b) => n + b.option.usageCount, 0);
  const fileHolders = new Map<string, number>();
  for (const b of built) for (const f of new Set(b.allFiles)) fileHolders.set(f, (fileHolders.get(f) ?? 0) + 1);
  const byOption: DecisionCard["impact"]["byOption"] = {};
  for (const b of kept) {
    // 다른 옵션 중 하나라도 쓰는 파일 = 전체 합집합 − 이 옵션만 쓰는 파일
    const onlyHere = [...new Set(b.allFiles)].filter((f) => fileHolders.get(f) === 1).length;
    byOption[b.option.id] = { callSites: totalCalls - b.option.usageCount, files: fileHolders.size - onlyHere };
  }
  return { byOption };
}

function recommend(built: Built[], useMatchRate: boolean): DecisionCard["recommendation"] {
  const options = built.map((b) => b.option);
  const rateOf = new Map(built.map((b) => [b.option.id, useMatchRate ? b.matchRate : b.tokenRate]));
  const rateLabel = useMatchRate ? "토큰 일치율" : "토큰 사용 비율";
  const ds = options.filter((o) => o.isDs);
  const only = ds.length === 1 ? ds[0] : undefined;
  if (only) {
    return {
      optionId: only.id,
      reason: `DS 모듈(${only.module ?? only.file ?? only.id})에서 온 옵션`,
      confidence: "high",
      rule: "ds-module",
    };
  }
  // DS 옵션이 2개 이상이면 그 옵션들로 좁혀 다음 규칙을 적용한다.
  const narrowed = ds.length >= 2;
  const pool = narrowed ? ds : options;
  const scope = narrowed ? `DS 옵션 ${ds.length}개 중 ` : "";

  const maxUsage = Math.max(...pool.map((o) => o.usageCount));
  const mostUsed = pool.filter((o) => o.usageCount === maxUsage);
  const topUsage = mostUsed.length === 1 ? mostUsed[0] : undefined;
  if (topUsage) {
    return {
      optionId: topUsage.id,
      reason: `${scope}사용 수 ${topUsage.usageCount}회로 가장 많음`,
      confidence: "medium",
      rule: "usage",
    };
  }

  const rated = pool.flatMap((o) => {
    const rate = rateOf.get(o.id);
    return rate === null || rate === undefined ? [] : [{ option: o, rate }];
  });
  const maxRate = Math.max(...rated.map((r) => r.rate));
  const bestRate = rated.filter((r) => r.rate === maxRate);
  const topRate = bestRate.length === 1 ? bestRate[0] : undefined;
  if (topRate) {
    return {
      optionId: topRate.option.id,
      reason: `${scope}${rateLabel} ${Math.round(topRate.rate * 1000) / 10}%로 가장 높음`,
      confidence: "low",
      rule: "token-rate",
    };
  }

  const first = pool[0] ?? options[0];
  return { optionId: first?.id ?? "", reason: "근거가 동률 — 사람이 판단", confidence: "low", rule: "tie" };
}

/** 사용 수 상위 maxOptions개 + 추천 옵션. built는 이미 정렬돼 있다. */
function keptOf(built: Built[], recommendedId: string, maxOptions: number | undefined): Built[] {
  if (maxOptions === undefined || built.length <= maxOptions) return built;
  const top = built.slice(0, Math.max(0, maxOptions));
  const rec = built.find((b) => b.option.id === recommendedId);
  if (rec && !top.includes(rec)) top.push(rec);
  return built.filter((b) => top.includes(b));
}

/**
 * 후보 하나를 결정 카드로 조립한다. 파일·git을 읽지 않는 순수 함수.
 * 추천·differences·impact는 전체 옵션 기준으로 계산하고, `maxOptions`가 있으면 옵션 목록과 옵션별 맵만 잘라 싣는다.
 */
export function buildDecisionCard(input: CardInput): DecisionCard {
  const { candidate, index, record } = input;
  const localUses = new Map<string, ComponentUsage[]>();
  if (candidate.kind === "local-definition") {
    for (const c of index.components) {
      if (c.name !== candidate.item || c.importedFrom !== null) continue;
      const list = localUses.get(c.file) ?? [];
      list.push(c);
      localUses.set(c.file, list);
    }
  }
  const lookup: Lookup = {
    summaries: summarizeComponents(index.components.filter((c) => c.name === candidate.item)),
    localUses,
    rated: ratedStylesByFile(index.styles),
  };

  const built = candidate.optionIds
    .map((id) => buildOption(input, id, lookup))
    .sort((a, b) => b.option.usageCount - a.option.usageCount || byCodeUnit(a.option.id, b.option.id));

  const useMatchRate = input.tokens !== undefined && input.tokens.length > 0;
  const recommendation = recommend(built, useMatchRate);
  const kept = keptOf(built, recommendation.optionId, input.maxOptions);
  const keptIds = new Set(kept.map((b) => b.option.id));

  const differences = differencesOf(candidate.kind, built)
    .map((d) => ({
      aspect: d.aspect,
      byOption: Object.fromEntries(Object.entries(d.byOption).filter(([id]) => keptIds.has(id))),
    }))
    .filter((d) => Object.keys(d.byOption).length > 0);

  const card: DecisionCard = {
    item: candidate.item,
    kind: candidate.kind,
    styleScope: built.some((b) => b.narrowed) ? "declaration" : "file",
    options: kept.map((b) => b.option),
    differences,
    impact: impactOf(built, kept),
    ruleCheck: { tokenUsageRate: Object.fromEntries(kept.map((b) => [b.option.id, b.tokenRate])) },
    recommendation,
  };
  if (useMatchRate) card.ruleCheck.tokenMatchRate = Object.fromEntries(kept.map((b) => [b.option.id, b.matchRate]));

  if (kept.length < built.length) {
    const dropped = built.filter((b) => !keptIds.has(b.option.id));
    card.omittedOptions = {
      count: dropped.length,
      callSites: dropped.reduce((n, b) => n + b.option.usageCount, 0),
      files: new Set(dropped.flatMap((b) => b.allFiles)).size,
    };
  }

  const byOption: Record<string, GitHistory> = {};
  for (const b of kept) {
    const h = b.option.file === undefined ? undefined : input.history[b.option.file];
    if (h) byOption[b.option.id] = h;
  }
  if (Object.keys(byOption).length > 0) card.history = { byOption };

  if (record?.status === "decided" && record.chosen !== undefined) {
    card.decided = { chosen: record.chosen, decidedAt: record.decidedAt ?? "" };
    if (record.note !== undefined) card.decided.note = record.note;
  }
  return card;
}
