import type { Token } from "@dsmith-dev/core";
import type { ApplyResult } from "./apply.js";
import type { ComponentPlanSummary, ComponentSkipReason } from "./components.js";
import type { MigratePlan, TokenSkipReason } from "./plan.js";

export interface AuditNumbers {
  score: number;
  hardcodedShare: number;
  residual: Record<Token["category"], number>;
}

const CATEGORY_LABEL: Record<Token["category"], string> = {
  color: "색",
  spacing: "간격",
  radius: "모서리",
  "font-size": "글꼴 크기",
};
const CATEGORIES: Token["category"][] = ["color", "spacing", "radius", "font-size"];

const SKIP_EXPLAIN: Record<TokenSkipReason, string> = {
  "no-token-ref": "이 방식에는 토큰을 참조하는 문자열이 없음(토큰 이름이 CSS 변수가 아니거나 방식이 지원하지 않음)",
  "no-patch": "치환할 소스 구간을 정하지 못함",
  overlap: "다른 치환과 소스 구간이 겹쳐 보류",
  "translucent-color": "반투명 색(alpha < 1)은 토큰이 불투명이라 바꾸면 투명도가 사라져 건너뜀",
  "binary-or-non-utf8": "UTF-8이 아닌 파일은 다시 인코딩하면 바이트가 달라져 건너뜀",
  "negative-value": "음수 값은 토큰 참조로 바꾸면 부호가 사라져 건너뜀(Tailwind 제외)",
  "zero-value": "0 값은 토큰으로 바꾸지 않음",
  "scss-variable": "SCSS·Less 변수가 섞인 값은 건너뜀",
  "multi-value": "다중 값 단축 속성(padding: 8px 12px 등)은 첫 값만 바꿀 수 없어 건너뜀",
  "rolled-back": "적용 중 검증(재파싱·재추출·해시)에 실패해 그 파일은 무변경",
};
const SKIP_ORDER: TokenSkipReason[] = [
  "no-token-ref",
  "no-patch",
  "overlap",
  "translucent-color",
  "binary-or-non-utf8",
  "negative-value",
  "zero-value",
  "scss-variable",
  "multi-value",
  "rolled-back",
];

export const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;

const HELD_EXPLAIN: Record<ComponentSkipReason, string> = {
  "decision-pending": "결정이 끝나지 않은 항목 — `dsmith decide`로 결정하면 대상이 됨",
  "mapping-missing": "대상 컴포넌트에 없는 prop(또는 허용하지 않는 값) — `decide --map <from>:<to>`로 대응을 주면 대상이 됨",
  "mapping-conflict": "이름을 바꾸면 같은 요소에 같은 속성이 둘이 됨 — `decide --map`을 고쳐야 대상이 됨",
  "non-jsx-use": "JSX 태그가 아닌 곳(<Name.Sub>·styled(Name)·as={Name}·createElement·값 전달)에서 쓰여 prop 대응을 확인할 수 없음",
  "spread-props": "{...props} 스프레드가 있어 prop 대응을 확인할 수 없음",
  "export-unknown": "대상의 내보내기 방식(named·default)을 알 수 없음",
  overlap: "토큰 치환과 소스 구간이 겹쳐 보류",
  "rolled-back": "치환 뒤 재검증(재파싱·컴포넌트 재추출)에 실패해 무변경",
};
const HELD_ORDER: ComponentSkipReason[] = ["decision-pending", "mapping-missing", "mapping-conflict", "non-jsx-use", "spread-props", "export-unknown", "overlap", "rolled-back"];

function heldSummary(held: ComponentPlanSummary["held"]): string {
  return HELD_ORDER.filter((r) => (held[r] ?? 0) > 0)
    .map((r) => `${r} ${held[r]}`)
    .join(" · ");
}

/** 컴포넌트 결정이 하나라도 있을 때만 나오는 줄들 */
function componentLines(plan: MigratePlan, limit: number): string[] {
  const c = plan.components;
  if (c.decided === 0 && c.pending === 0) return [];
  const lines: string[] = [];
  const done =
    c.imports + c.props + c.annotations === 0
      ? "치환할 것이 없음"
      : `파일 ${c.files} · import ${c.imports} · prop ${c.props}${c.annotations > 0 ? ` · 지역 정의 주석 ${c.annotations}` : ""}`;
  const held = heldSummary(c.held);
  lines.push(`컴포넌트: 결정 ${c.decided}건 → ${done}${held === "" ? "" : `   |   보류 ${held}`}`);
  for (const h of plan.componentHeld.slice(0, limit)) lines.push(`  보류 ${h.file}:${h.line} ${h.item} — ${h.reason}: ${h.detail}`);
  if (plan.componentHeld.length > limit) lines.push(`  … 외 ${plan.componentHeld.length - limit}건`);
  for (const p of plan.componentPending) lines.push(`  결정 대기 ${p.item} (${p.kind}, 파일 ${p.files})`);
  return lines;
}

function skipSummary(skipped: MigratePlan["skipped"]): string {
  return SKIP_ORDER.filter((r) => (skipped[r] ?? 0) > 0)
    .map((r) => `${r} ${skipped[r]}`)
    .join(" · ");
}

function skippedTotal(skipped: MigratePlan["skipped"]): number {
  return SKIP_ORDER.reduce((n, r) => n + (skipped[r] ?? 0), 0);
}

function categorySummary(by: Record<Token["category"], number>): string {
  return CATEGORIES.filter((c) => by[c] > 0)
    .map((c) => `${CATEGORY_LABEL[c]} ${by[c]}`)
    .join(" · ");
}

function tokenLine(plan: MigratePlan): string {
  const first = plan.tokens.files[0];
  const where = first === undefined ? plan.tokens.source : plan.tokens.files.length > 1 ? `${first} 외 ${plan.tokens.files.length - 1}` : first;
  let line = `토큰: ${where} (${plan.tokens.source}, ${plan.tokens.count}개)`;
  if (plan.preset !== null) line += plan.preset.linked ? " · Tailwind 프리셋 연결됨 → 클래스명으로 치환" : " · Tailwind 프리셋 연결 안 됨 → 임의값으로 치환";
  return line;
}

/** `dsmith migrate`(계획)의 사람용 출력. 숫자는 모두 plan(과 CLI가 계산한 예상 점수)에서 온다 */
export function formatPlanSummary(
  plan: MigratePlan,
  projected: { before: AuditNumbers; after: AuditNumbers } | null,
  opts: { hint?: boolean } = {},
): string {
  const lines: string[] = [];
  const staleCount = plan.stale.changed.length + plan.stale.added.length;
  if (staleCount > 0) {
    const added = plan.stale.added.length > 0 ? `(인덱스에 없던 새 파일 ${plan.stale.added.length}개 포함)` : "";
    lines.push(`인덱스가 오래됨: ${staleCount}개 파일이 audit 이후 바뀜${added} — dsmith audit을 다시 실행하세요`);
  }
  lines.push(tokenLine(plan));
  const planned = plan.planned === 0 ? "치환할 것이 없음" : `파일 ${plan.files.filter((f) => f.replacements.length > 0).length} · 치환 ${plan.planned} (${categorySummary(plan.byCategory)})`;
  lines.push(`계획: ${planned}`);
  if (plan.planned > 0) {
    const c = plan.confidence;
    lines.push(`신뢰도: 같은 값 ${c.identical} · exact(거의 같음) ${c.exact} · close ${c.close}`);
  }
  const skipTotal = skippedTotal(plan.skipped);
  const skipPart = skipTotal === 0 ? "건너뜀 0" : `건너뜀 ${skipTotal} (${skipSummary(plan.skipped)})`;
  const range = plan.scope.outOfRange > 0 ? ` + 범위 제한 ${plan.scope.outOfRange}` : "";
  const closePart = plan.close.length > 0 ? ` + close 제외 ${plan.close.length}` : "";
  lines.push(
    `후보 ${plan.scope.candidates} = 계획 ${plan.planned} + ${skipPart}${range}${closePart}   |   범위 밖: 먼 값 ${plan.scope.far} · 동적 ${plan.scope.dynamic}`,
  );
  if (plan.close.length > 0) lines.push(`close 후보 ${plan.close.length}건 — --close로 포함`);
  if (projected !== null && plan.planned > 0) {
    lines.push(`예상: 하드코딩 비율 ${pct(projected.before.hardcodedShare)} → ${pct(projected.after.hardcodedShare)}, 점수 ${projected.before.score} → ${projected.after.score}`);
  }
  lines.push(...componentLines(plan, 8));
  for (const note of plan.notes) lines.push(`참고: ${note}`);
  const anything = plan.planned > 0 || plan.components.imports + plan.components.props + plan.components.annotations > 0;
  if (anything && opts.hint !== false) lines.push("적용: dsmith migrate --apply   (되돌리기: dsmith migrate --revert <id>)");
  return lines.join("\n");
}

/** `.dsmith/reports/migrate-<date>.md` 본문. 타임스탬프·절대 경로 없음 */
export function renderMigrateReport(input: { plan: MigratePlan; applied: ApplyResult; before: AuditNumbers; after: AuditNumbers }): string {
  const { plan, applied, before, after } = input;
  const lines: string[] = ["# DS Migrate", ""];
  lines.push(`- 기록: \`${applied.id}\` (\`${applied.record}\`)`);
  lines.push(`- 토큰 출처: ${tokenLine(plan).slice("토큰: ".length)}`, "");

  lines.push("## 전/후", "");
  lines.push("| 항목 | 전 | 후 |", "| --- | --- | --- |");
  lines.push(`| 점수 | ${before.score} | ${after.score} |`);
  lines.push(`| 하드코딩 비율 | ${pct(before.hardcodedShare)} | ${pct(after.hardcodedShare)} |`);
  for (const c of CATEGORIES) lines.push(`| 남은 하드코딩: ${CATEGORY_LABEL[c]} | ${before.residual[c]} | ${after.residual[c]} |`);
  lines.push("");

  const appliedFiles = applied.files.filter((f) => f.status === "applied");
  lines.push("## 치환", "");
  lines.push(`적용: ${appliedFiles.length}개 파일 · 치환 ${applied.replaced}`, "");
  lines.push("| 카테고리 | 계획 |", "| --- | --- |");
  for (const c of CATEGORIES) lines.push(`| ${CATEGORY_LABEL[c]} | ${plan.byCategory[c]} |`);
  lines.push("");
  const conf = plan.confidence;
  lines.push(`신뢰도: 값이 정확히 같음 ${conf.identical} · exact(거리 > 0) ${conf.exact} · close ${conf.close}`);
  lines.push(
    plan.includeClose
      ? "`--close`로 근사(close) 매칭을 포함함 — 렌더링되는 값이 바뀔 수 있음"
      : `close 후보 ${plan.close.length}건은 계획에서 제외(\`--close\`로 포함)`,
    "",
  );
  const top = [...appliedFiles].sort((a, b) => b.replacements - a.replacements || (a.file < b.file ? -1 : 1)).slice(0, 20);
  if (top.length > 0) {
    lines.push("| 파일 | 치환 |", "| --- | --- |");
    for (const f of top) lines.push(`| ${f.file} | ${f.replacements} |`);
    if (appliedFiles.length > top.length) lines.push("", `상위 ${top.length}개 파일만 표시(전체 ${appliedFiles.length}개).`);
    lines.push("");
  }

  if (plan.components.decided > 0 || plan.components.pending > 0) {
    lines.push("## 컴포넌트", "");
    lines.push(`적용: import ${applied.components} · prop ${applied.props} · 지역 정의 주석 ${applied.annotations}${applied.componentsRolledBack > 0 ? ` (되돌린 파일의 import ${applied.componentsRolledBack})` : ""}`, "");
    const edited = appliedFiles.filter((f) => f.components + f.props + f.annotations > 0);
    if (edited.length > 0) {
      lines.push("| 파일 | import | prop | 주석 |", "| --- | --- | --- | --- |");
      for (const f of edited.slice(0, 20)) lines.push(`| ${f.file} | ${f.components} | ${f.props} | ${f.annotations} |`);
      if (edited.length > 20) lines.push("", `상위 20개 파일만 표시(전체 ${edited.length}개).`);
      lines.push("");
    }
    const held = heldSummary(plan.components.held);
    lines.push(held === "" ? "보류: 없음" : `보류: ${held}`, "");
    for (const r of HELD_ORDER) {
      if ((plan.components.held[r] ?? 0) > 0) lines.push(`- ${r}: ${HELD_EXPLAIN[r]}`);
    }
    for (const h of plan.componentHeld) lines.push(`  - ${h.file}:${h.line} ${h.item} (${h.reason}) ${h.detail}`);
    for (const p of plan.componentPending) lines.push(`  - 결정 대기 ${p.item} (${p.kind}, 파일 ${p.files})`);
    lines.push("");
  }

  lines.push("## 건너뜀", "");
  const reasons = SKIP_ORDER.filter((r) => (plan.skipped[r] ?? 0) > 0 || (applied.skipped[r] ?? 0) > 0);
  if (reasons.length === 0) {
    lines.push("없음", "");
  } else {
    for (const r of reasons) lines.push(`- ${r} ${(plan.skipped[r] ?? 0) + (applied.skipped[r] ?? 0)}: ${SKIP_EXPLAIN[r]}`);
    lines.push("");
  }
  const failed = applied.files.filter((f) => f.status !== "applied");
  if (failed.length > 0) {
    lines.push("되돌린(적용하지 못한) 파일:", "");
    for (const f of failed) lines.push(`- ${f.file} — ${f.status}${f.reason === undefined ? "" : `: ${f.reason}`}`);
    lines.push("");
  }
  lines.push(`범위 밖: 가까운 토큰이 없는 값 ${plan.scope.far} · 동적 값 ${plan.scope.dynamic}`, "");

  lines.push("## 되돌리기", "");
  lines.push("```", `dsmith migrate --revert ${applied.id}`, "```");
  return `${lines.join("\n")}\n`;
}
