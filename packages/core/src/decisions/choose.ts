import type { Index } from "../index/indexer.js";
import { candidatesOf, similarItems } from "./candidates.js";
import type { DecisionKind, DecisionRecord } from "./model.js";
import { readDecisions, recordDecision, writeDecisions } from "./store.js";

export interface ChooseOptions {
  note?: string;
  /** decidedAt에 쓸 시각. 기본은 지금. */
  now?: Date;
  /** 같은 이름이 duplicate와 local-definition 둘 다이고 optionId로도 가려지지 않을 때 고르는 종류 */
  kind?: DecisionKind;
}

/**
 * 결정을 기록한다(.dsmith/decisions.json). optionId를 선택지로 가진 후보를 골라 (item, kind)로 upsert한다.
 * 이미 같은 선택·같은 메모로 결정돼 있으면 파일을 건드리지 않고 기존 기록을 돌려준다(decidedAt 유지).
 * 항목이 없거나, optionId가 선택지가 아니거나, 어느 종류인지 가려지지 않으면 Error.
 */
export async function chooseDecision(
  root: string,
  index: Index,
  item: string,
  optionId: string,
  opts: ChooseOptions = {},
): Promise<DecisionRecord> {
  const file = await readDecisions(root);
  const matches = candidatesOf(index, item, opts.kind, file);
  if (matches.length === 0) {
    const similar = similarItems(index, item);
    const hint = similar.length > 0 ? ` 비슷한 항목: ${similar.join(", ")}` : "";
    throw new Error(`결정할 항목이 아님: ${item}.${hint}`);
  }
  const owners = matches.filter((c) => c.optionIds.includes(optionId));
  if (owners.length === 0) {
    const ids = [...new Set(matches.flatMap((c) => c.optionIds))];
    throw new Error(`선택지 아님: ${optionId}. 가능: ${ids.join(", ")}`);
  }
  const [candidate] = owners;
  if (owners.length > 1 || candidate === undefined) {
    throw new Error(`종류가 모호함: ${item}의 ${optionId}는 ${owners.map((c) => c.kind).join(", ")} 모두에 있습니다. kind를 지정하세요`);
  }

  const existing = file.items.find((r) => r.item === candidate.item && r.kind === candidate.kind);
  if (
    existing?.status === "decided" &&
    existing.chosen === optionId &&
    existing.note === opts.note &&
    existing.options.length === candidate.optionIds.length &&
    existing.options.every((id, i) => id === candidate.optionIds[i])
  ) {
    return existing;
  }

  const record: DecisionRecord = {
    item: candidate.item,
    kind: candidate.kind,
    status: "decided",
    options: candidate.optionIds,
    chosen: optionId,
    decidedAt: (opts.now ?? new Date()).toISOString(),
  };
  if (opts.note !== undefined) record.note = opts.note;
  await writeDecisions(root, recordDecision(file, record));
  return record;
}
