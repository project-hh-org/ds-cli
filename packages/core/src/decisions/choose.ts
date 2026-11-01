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
  /** 컴포넌트 치환 때 props 대응(`DecisionRecord.mapping`). 키·값 모두 "prop" 또는 "prop=value", 양쪽 형태가 같아야 한다. 생략하면 기존 mapping을 유지하고, 주면 통째로 바꾸며, 빈 객체면 지운다 */
  mapping?: Record<string, string>;
}

/** JSX 속성 이름으로 쓸 수 있는 prop 이름(`data-*`·`aria-*` 포함) */
const ATTR_NAME = /^[A-Za-z_$][\w$-]*$/;

/** mapping 형식 검사: 빈 키·값 없음, "="는 한 개까지, 한쪽만 "prop=value"면 안 된다. 어기면 Error */
function checkMapping(mapping: Record<string, string>): void {
  for (const [from, to] of Object.entries(mapping)) {
    if (from === "" || to === "") throw new Error(`mapping에 빈 키나 값이 있음: "${from}" → "${to}"`);
    for (const side of [from, to]) {
      if (side.split("=").length > 2) throw new Error(`mapping은 "="를 한 개까지만 쓸 수 있음: "${side}"`);
      const [name, value] = side.split("=");
      if (name === "" || (side.includes("=") && (value === undefined || value === ""))) {
        throw new Error(`mapping 형식은 prop 또는 prop=value: "${side}"`);
      }
      if (!ATTR_NAME.test(name ?? "")) throw new Error(`mapping의 prop 이름은 JSX 속성 이름이어야 함(영문자·_·$로 시작, 영숫자·_·$·- 허용): "${name}"`);
    }
    if (from.includes("=") !== to.includes("=")) {
      throw new Error(`mapping은 양쪽 모두 prop이거나 양쪽 모두 prop=value여야 함: "${from}" → "${to}"`);
    }
  }
}

const sameMapping = (a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean => {
  const ea = Object.entries(a ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  const eb = Object.entries(b ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return ea.length === eb.length && ea.every(([k, v], i) => k === eb[i]?.[0] && v === eb[i]?.[1]);
};

/**
 * 결정을 기록한다(.dsmith/decisions.json). optionId를 선택지로 가진 후보를 골라 (item, kind)로 upsert한다.
 * 이미 같은 선택·같은 메모로 결정돼 있으면 파일을 건드리지 않고 기존 기록을 돌려준다(decidedAt 유지).
 * 항목이 없거나, optionId가 선택지가 아니거나, 어느 종류인지 가려지지 않으면 Error.
 */
export async function chooseDecision(
  root: string,
  index: Index,
  item: string,
  optionIdArg: string,
  opts: ChooseOptions = {},
): Promise<DecisionRecord> {
  if (opts.mapping !== undefined) checkMapping(opts.mapping);
  const file = await readDecisions(root);
  const matches = candidatesOf(index, item, opts.kind, file);
  if (matches.length === 0) {
    const similar = similarItems(index, item);
    const hint = similar.length > 0 ? ` 비슷한 항목: ${similar.join(", ")}` : "";
    throw new Error(`결정할 항목이 아님: ${item}.${hint}`);
  }
  // token-cluster 선택지는 소문자 hex라 대소문자를 맞춰 받는다(셸에서는 "#3b82f6"처럼 따옴표로 감싼다)
  const optionId =
    matches.some((c) => c.optionIds.includes(optionIdArg)) || !matches.some((c) => c.kind === "token-cluster")
      ? optionIdArg
      : optionIdArg.toLowerCase();
  const owners = matches.filter((c) => c.optionIds.includes(optionId));
  if (owners.length === 0) {
    const ids = [...new Set(matches.flatMap((c) => c.optionIds))];
    const hexHint = matches.some((c) => c.kind === "token-cluster") ? ` (hex는 셸에서 따옴표로 감싸세요: --choose "${matches.find((c) => c.kind === "token-cluster")?.optionIds[0] ?? "#3b82f6"}")` : "";
    throw new Error(`선택지 아님: ${optionIdArg}. 가능: ${ids.join(", ")}${hexHint}`);
  }
  const [candidate] = owners;
  if (owners.length > 1 || candidate === undefined) {
    throw new Error(`종류가 모호함: ${item}의 ${optionId}는 ${owners.map((c) => c.kind).join(", ")} 모두에 있습니다. kind를 지정하세요`);
  }

  const existing = file.items.find((r) => r.item === candidate.item && r.kind === candidate.kind);
  // mapping: 주면 통째로 바꾼다(빈 객체면 지운다). 안 주면 기존 mapping을 유지한다(메모만 고칠 때 대응이 사라지지 않게)
  const mapping =
    opts.mapping === undefined ? (existing?.status === "decided" ? existing.mapping : undefined) : Object.keys(opts.mapping).length > 0 ? opts.mapping : undefined;
  if (
    existing?.status === "decided" &&
    existing.chosen === optionId &&
    existing.note === opts.note &&
    sameMapping(existing.mapping, mapping) &&
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
  if (mapping !== undefined) record.mapping = mapping;
  await writeDecisions(root, recordDecision(file, record));
  return record;
}
