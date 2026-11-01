import path from "node:path";
import {
  chooseDecision,
  explainDecision,
  listDecisions,
  readDecisions,
  readIndex,
  type DecisionKind,
  type DecisionListItem,
  type DecisionRecord,
  type ExplainResult,
  type Index,
} from "@dsmith-dev/core";
import { isDsSpecifier, readDetect } from "@dsmith-dev/detect";

const NEED_AUDIT = "먼저 dsmith audit을 실행하세요";

interface Audited {
  root: string;
  index: Index;
  isDsModule: (module: string) => boolean;
}

/** audit이 남긴 .dsmith/index.json·detect.json을 읽는다. 없으면 안내 에러. */
async function loadAudited(rootArg: string): Promise<Audited> {
  const root = path.resolve(rootArg);
  const [index, detected] = await Promise.all([readIndex(root), readDetect(root)]);
  if (index === null || detected === null) throw new Error(NEED_AUDIT);
  return { root, index, isDsModule: (m) => isDsSpecifier(m, detected.ds) };
}

export async function runDecideList(rootArg: string, status?: "pending" | "decided"): Promise<DecisionListItem[]> {
  const { root, index } = await loadAudited(rootArg);
  return listDecisions(index, await readDecisions(root), status);
}

export async function runDecideExplain(
  rootArg: string,
  item: string,
  opts: { git?: boolean; kind?: DecisionKind } = {},
): Promise<ExplainResult> {
  const { root, index, isDsModule } = await loadAudited(rootArg);
  const decisions = await readDecisions(root);
  return explainDecision(root, index, item, {
    isDsModule,
    decisions,
    ...(opts.git === undefined ? {} : { git: opts.git }),
    ...(opts.kind === undefined ? {} : { kind: opts.kind }),
  });
}

export async function runDecideChoose(
  rootArg: string,
  item: string,
  optionId: string,
  note?: string,
  opts: { kind?: DecisionKind } = {},
): Promise<DecisionRecord> {
  const { root, index } = await loadAudited(rootArg);
  return chooseDecision(root, index, item, optionId, {
    ...(note === undefined ? {} : { note }),
    ...(opts.kind === undefined ? {} : { kind: opts.kind }),
  });
}

/** `pending N건 / decided M건` + 항목 한 줄씩 */
export function formatDecideList(items: DecisionListItem[]): string {
  const pending = items.filter((i) => i.status === "pending").length;
  const lines = [`pending ${pending}건 / decided ${items.length - pending}건`];
  for (const i of items) {
    const tail = i.status === "decided" ? `결정: ${i.decided ?? ""}` : `선택지 ${i.options.length}개`;
    lines.push(`- [${i.status}] ${i.item} (${i.kind}) — ${tail}`);
  }
  return lines.join("\n");
}

/** 옵션·추천을 한 줄씩 */
export function formatDecideExplain(result: ExplainResult): string {
  if ("error" in result) {
    if (result.error === "ambiguous-kind") return `종류가 둘 이상입니다: ${result.kinds.join(", ")}. --kind로 지정하세요`;
    const hint = result.candidates.length > 0 ? ` 비슷한 항목: ${result.candidates.join(", ")}` : "";
    return `결정할 항목이 아님.${hint}`;
  }
  const { card } = result;
  const lines = [`${card.item} (${card.kind})`];
  for (const o of card.options) {
    lines.push(`- ${o.id}${o.isDs ? " [DS]" : ""} — 사용 ${o.usageCount}회, 파일 ${o.files.length}개`);
  }
  const { recommendation: r } = card;
  lines.push(`추천: ${r.optionId} (${r.rule}, ${r.confidence}) — ${r.reason}`);
  if (card.decided) lines.push(`결정됨: ${card.decided.chosen} (${card.decided.decidedAt})`);
  return lines.join("\n");
}
