import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { summarizeComponents, type ComponentSummary } from "../component/summary.js";
import type { Index } from "../index/indexer.js";
import { isRatedUsage } from "../model/style-usage.js";
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

function tokenRateOf(rated: StyleUsage[]): number | null {
  if (rated.length === 0) return null;
  return round4(rated.filter((u) => u.source === "token").length / rated.length);
}

function buildOption(input: CardInput, id: string, summaries: ComponentSummary[], rated: Map<string, StyleUsage[]>): Built {
  const { candidate, index } = input;
  const isLocal = candidate.kind === "local-definition";

  let usageCount: number;
  let allFiles: string[];
  let props: string[];
  let file: string | null;
  let isDs: boolean;
  if (isLocal) {
    const uses = index.components.filter((c) => c.name === candidate.item && c.file === id && c.importedFrom === null);
    usageCount = uses.length;
    allFiles = usageCount > 0 ? [id] : [];
    props = [...new Set(uses.flatMap((c) => c.props))].sort(byCodeUnit);
    file = id;
    isDs = input.isDsModule(stripExtension(id));
  } else {
    const summary = summaries.find((s) => s.module === id);
    usageCount = summary?.count ?? 0;
    allFiles = summary?.files.map((f) => f.file) ?? [];
    props = summary?.props ?? [];
    file = input.definitionFiles[id] ?? null;
    isDs = input.isDsModule(id);
  }

  const definitionStyles = file === null ? [] : (rated.get(file) ?? []);
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
  return { option, allFiles, tokenRate: tokenRateOf(definitionStyles) };
}

/** 각 옵션에만 있는 값. 어느 옵션에도 단독 값이 없으면 null(그 aspect는 차이가 아니다). */
function exclusiveValues(byOption: Map<string, string[]>): Record<string, string[]> | null {
  const result: Record<string, string[]> = {};
  let any = false;
  for (const [id, values] of byOption) {
    const others = new Set<string>();
    for (const [otherId, otherValues] of byOption) {
      if (otherId !== id) for (const v of otherValues) others.add(v);
    }
    const only = values.filter((v) => !others.has(v));
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

function impactOf(built: Built[]): DecisionCard["impact"] {
  const byOption: DecisionCard["impact"]["byOption"] = {};
  for (const b of built) {
    const others = built.filter((o) => o !== b);
    byOption[b.option.id] = {
      callSites: others.reduce((n, o) => n + o.option.usageCount, 0),
      files: new Set(others.flatMap((o) => o.allFiles)).size,
    };
  }
  return { byOption };
}

function recommend(built: Built[]): DecisionCard["recommendation"] {
  const options = built.map((b) => b.option);
  const rateOf = new Map(built.map((b) => [b.option.id, b.tokenRate]));
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
  const pool = ds.length >= 2 ? ds : options;

  const maxUsage = Math.max(...pool.map((o) => o.usageCount));
  const mostUsed = pool.filter((o) => o.usageCount === maxUsage);
  const topUsage = mostUsed.length === 1 ? mostUsed[0] : undefined;
  if (topUsage) {
    return { optionId: topUsage.id, reason: `사용 수 ${topUsage.usageCount}회로 가장 많음`, confidence: "medium", rule: "usage" };
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
      reason: `토큰 일치율 ${Math.round(topRate.rate * 1000) / 10}%로 가장 높음`,
      confidence: "low",
      rule: "token-rate",
    };
  }

  const first = pool[0] ?? options[0];
  return { optionId: first?.id ?? "", reason: "근거가 동률 — 사람이 판단", confidence: "low", rule: "tie" };
}

/** 후보 하나를 결정 카드로 조립한다. 파일·git을 읽지 않는 순수 함수. */
export function buildDecisionCard(input: CardInput): DecisionCard {
  const { candidate, index, record } = input;
  const summaries = summarizeComponents(index.components.filter((c) => c.name === candidate.item));
  const rated = ratedStylesByFile(index.styles);

  const built = candidate.optionIds
    .map((id) => buildOption(input, id, summaries, rated))
    .sort((a, b) => b.option.usageCount - a.option.usageCount || byCodeUnit(a.option.id, b.option.id));

  const card: DecisionCard = {
    item: candidate.item,
    kind: candidate.kind,
    options: built.map((b) => b.option),
    differences: differencesOf(candidate.kind, built),
    impact: impactOf(built),
    ruleCheck: { tokenMatchRate: Object.fromEntries(built.map((b) => [b.option.id, b.tokenRate])) },
    recommendation: recommend(built),
  };

  const byOption: Record<string, GitHistory> = {};
  for (const b of built) {
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
