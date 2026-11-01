import type { PropInfo } from "@dsmith-dev/core";
import type { CatalogProp } from "@dsmith-dev/core";

/** 컴포넌트 이름 규칙: 대문자로 시작, 소문자를 하나 이상 포함(ALL_CAPS 상수 제외), Props·Context로 끝나지 않음 */
export function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) && /[a-z]/.test(name) && !/(Props|Context)$/.test(name);
}

export function toCatalogProp(p: PropInfo): CatalogProp {
  return { ...p, type: p.type ?? "unknown", required: p.required ?? false };
}

export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
