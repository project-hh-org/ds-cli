import { COVERAGE_PROPERTIES, isRatedUsage, tokenCategoryOf, type ComponentUsage, type StyleUsage, type Token } from "@dsmith-dev/core";
import type { FilePlan, MigratePlan, UsageRef } from "./plan.js";

export function usageKey(u: UsageRef): string {
  return `${u.file}:${u.line}:${u.column}:${u.property}:${u.extractor}:${u.raw}`;
}

/** plan의 계획 사용과 같은 키의 사용을 source "token"으로 바꾼 사본(나머지는 같은 객체). CLI가 예상 점수를 계산할 때 쓴다 */
export function projectStyles(styles: StyleUsage[], plan: MigratePlan): StyleUsage[] {
  const keys = new Set<string>();
  for (const f of plan.files) for (const r of f.replacements) keys.add(usageKey(r));
  if (keys.size === 0) return styles;
  return styles.map((u) => (u.source === "hardcoded" && keys.has(usageKey(u)) ? { ...u, source: "token" } : u));
}

/**
 * 계획된 import 편집을 컴포넌트 사용에 반영한 사본(나머지는 같은 객체) — 편집 뒤 audit이 읽을 모양으로 맞춘다:
 * 편집이 있는 파일에서 그 항목의 사용은 module·importedFrom이 대상 module이 되고 지역 정의 표시는 사라진다.
 * duplicate는 가져온 원래 이름(별칭이면 `imported`)과 옮길 module(`from`)로, 지역 정의는 지역에 선언된 같은 이름으로 고른다.
 */
export function projectComponents(components: ComponentUsage[], plan: MigratePlan): ComponentUsage[] {
  const byFile = new Map<string, FilePlan["importTargets"]>();
  for (const f of plan.files) if (f.importTargets.length > 0) byFile.set(f.file, f.importTargets);
  if (byFile.size === 0) return components;
  return components.map((c) => {
    const target = byFile.get(c.file)?.find((t) =>
      t.kind === "duplicate" ? (c.imported ?? c.name) === t.item && t.from.includes(c.module) : c.name === t.item && c.declaredLocally === true,
    );
    if (target === undefined) return c;
    const { declaredLocally: _declaredLocally, ...rest } = c;
    return { ...rest, importedFrom: target.module, module: target.module };
  });
}

/**
 * 카테고리별 남은 hardcoded(토큰 대상 속성) 수. 계획의 범위와 같은 규칙: 0 이하 간격은 뺀다.
 * `exclude`가 참인 파일(토큰 파일·init 산출 디렉터리)은 세지 않는다.
 */
export function residualByCategory(styles: StyleUsage[], exclude?: (file: string) => boolean): Record<Token["category"], number> {
  const out: Record<Token["category"], number> = { color: 0, spacing: 0, radius: 0, "font-size": 0 };
  for (const u of styles) {
    if (u.source !== "hardcoded" || !isRatedUsage(u) || !COVERAGE_PROPERTIES.includes(u.property)) continue;
    if (exclude?.(u.file) === true) continue;
    const category = tokenCategoryOf(u.property);
    if (category === null) continue;
    if (category === "spacing" && u.normalized.kind === "length" && u.normalized.px <= 0) continue;
    out[category] += 1;
  }
  return out;
}

/** 계획이 치환 대상에서 뺀 파일(토큰 파일·init 산출 디렉터리)인가 — `residualByCategory`의 `exclude`로 쓴다 */
export function planExcludes(plan: MigratePlan): (file: string) => boolean {
  const files = new Set(plan.tokens.files);
  return (file) => files.has(file) || plan.tokens.excludeDirs.some((d) => d === "." || file === d || file.startsWith(`${d}/`));
}
