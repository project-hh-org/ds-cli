import type { StyleUsage, WritePatch } from "@dsmith/extractor-api";

/** 치환할 소스 구간. 문자열 값은 따옴표 안 하위 구간(`quote: false`), 숫자 값은 노드 전체(`quote: true`). */
export interface PatchTarget {
  file: string;
  start: number;
  end: number;
  quote: boolean;
}

const patchTargets = new WeakMap<StyleUsage, PatchTarget>();

/** extract가 리터럴 값 usage를 만들 때 호출해 치환 구간을 기록한다. */
export function registerPatchTarget(usage: StyleUsage, target: PatchTarget): void {
  patchTargets.set(usage, target);
}

/**
 * 기록해 둔 구간을 치환하는 패치를 만든다. 문자열 값은 따옴표 안 구간에 `tokenRef` 그대로,
 * 숫자 값(`fontSize: 13`)은 노드 전체를 문자열 CSS 값(`"var(--fs)"`)으로 바꾼다.
 * hardcoded가 아니거나(테마 스케일 token·dynamic) 이 추출기가 만들지 않은 usage는 null.
 */
export function write(usage: StyleUsage, tokenRef: string): WritePatch | null {
  if (usage.source !== "hardcoded") return null;
  const target = patchTargets.get(usage);
  if (target === undefined) return null;
  const replacement = target.quote ? JSON.stringify(tokenRef) : tokenRef;
  return { file: target.file, start: target.start, end: target.end, replacement };
}
