import type { PropInfo } from "@dsmith-dev/core";
import type { CatalogProp } from "@dsmith-dev/core";

/** 컴포넌트 이름 규칙: 대문자로 시작, 소문자를 포함하거나 짧은 이름(`^[A-Z][A-Z0-9]?\d*import type { PropInfo } from "@dsmith-dev/core";
import type { CatalogProp } from "@dsmith-dev/core";

), Props·Context로 끝나지 않음 */
export function isComponentName(name: string): boolean {
  if (!/^[A-Z]/.test(name) || /(Props|Context)$/.test(name)) return false;
  // 짧은 이름(H1, H2, A)은 허용, ALL_CAPS 상수(SIZES, MAX_SIZE)는 제외
  return /[a-z]/.test(name) || /^[A-Z][A-Z0-9]?\d*$/.test(name);
}

export function toCatalogProp(p: PropInfo): CatalogProp {
  return { ...p, type: p.type ?? "unknown", required: p.required ?? false };
}

export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
