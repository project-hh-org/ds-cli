import { describe, expect, it } from "vitest";
import { applyMigration, formatPlanSummary, planMigration, renderMigrateReport } from "../src/index.js";
import { auditFixture, loadState, syntheticRepo } from "./helpers.js";

const nums = (score: number, share: number) => ({ score, hardcodedShare: share, residual: { color: 3, spacing: 2, radius: 1, "font-size": 0 } });

describe("report", () => {
  it("계획 요약은 토큰·계획·후보 분해·예상을 보인다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const state = await loadState(root);
    const plan = await planMigration({ root, ...state });
    const text = formatPlanSummary(plan, { before: nums(52, 0.612), after: nums(63, 0.38) });
    const lines = text.split("\n");
    expect(lines[0]).toBe("토큰: styles/tokens.css (token-file, 5개)");
    expect(lines[1]).toMatch(/^계획: 파일 \d+ · 치환 \d+ \(색 \d+ · 간격 \d+/);
    expect(text).toContain(`후보 ${plan.scope.candidates} = 계획 ${plan.planned} + 건너뜀 0 + close 제외 1`);
    expect(text).toContain("close 후보 1건 — --close로 포함");
    expect(text).toContain("먼 값 1 · 동적 0");
    expect(text).toContain("예상: 하드코딩 비율 61.2% → 38.0%, 점수 52 → 63");
    expect(text).toContain("신뢰도: 같은 값");
    expect(text.endsWith("적용: dsmith migrate --apply   (되돌리기: dsmith migrate --revert <id>)")).toBe(true);
    expect(formatPlanSummary(plan, null)).not.toContain("예상:");
  });

  it("계획이 없으면 적용 안내를 내지 않는다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const plan = await planMigration({ root, ...(await loadState(root)), only: "components" });
    const text = formatPlanSummary(plan, null);
    expect(text).toContain("계획: 치환할 것이 없음");
    expect(text).not.toContain("dsmith migrate --apply");
  });

  it("적용 안내는 계획에 쓴 범위 플래그(--close·--files·--category·--only)를 그대로 되풀이한다 (M1)", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const plan = await planMigration({ root, ...(await loadState(root)), close: true });
    const text = formatPlanSummary(plan, null, { scopeFlags: '--close --files "src/*.tsx" --category color' });
    expect(text.endsWith('적용: dsmith migrate --apply --close --files "src/*.tsx" --category color   (되돌리기: dsmith migrate --revert <id>)')).toBe(true);
  });

  it("토큰 스타일시트가 로드되지 않았으면 리포트 파일에도 같은 한 줄이 든다 (I1)", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const state = await loadState(root);
    const plan = await planMigration({ root, ...state });
    const note = "토큰 스타일시트가 로드되지 않음: design-system/tokens.css를 전역 엔트리(예: app/layout.tsx, src/main.tsx, globals.css)에서 import하세요 — 치환된 var()가 비어 보입니다";
    const withNote = { ...plan, tokens: { ...plan.tokens, excludeDirs: ["design-system"], loaded: { css: false, evidence: null } }, notes: [...plan.notes, note] };
    const applied = await applyMigration(root, plan, { extractors: state.extractors, version: "t", now: new Date(2026, 10, 1, 9, 0, 0) });
    expect(renderMigrateReport({ plan: withNote, applied, before: nums(52, 0.6), after: nums(63, 0.4) })).toContain(`- ${note}`);
    expect(renderMigrateReport({ plan, applied, before: nums(52, 0.6), after: nums(63, 0.4) })).not.toContain("토큰 스타일시트");
  });

  it("리포트 파일은 전/후·치환·건너뜀·되돌리기 절을 가진다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const state = await loadState(root);
    const plan = await planMigration({ root, ...state });
    const applied = await applyMigration(root, plan, { extractors: state.extractors, version: "t", now: new Date(2026, 10, 1, 9, 0, 0) });
    const md = renderMigrateReport({ plan, applied, before: nums(52, 0.612), after: nums(63, 0.38) });
    expect(md.startsWith("# DS Migrate\n")).toBe(true);
    for (const h of ["## 전/후", "## 치환", "## 건너뜀", "## 되돌리기"]) expect(md).toContain(h);
    expect(md).toContain("| 점수 | 52 | 63 |");
    expect(md).toContain("| 하드코딩 비율 | 61.2% | 38.0% |");
    expect(md).toContain("close 후보 1건은 계획에서 제외(`--close`로 포함)");
    expect(md).toContain("dsmith migrate --revert 20261101-090000");
    expect(md).not.toContain(root);
  });
});
