import type { StyleUsage, WritePatch } from "@dsmith/extractor-api";

/** 치환 패치에 필요한 값(또는 축약 안의 색 토큰) 구간. */
interface PatchTarget {
  start: number;
  end: number;
  file: string;
}

const patchTargets = new WeakMap<StyleUsage, PatchTarget>();

/** extract가 hardcoded usage를 만들 때 호출해 치환 구간을 기록한다. */
export function registerPatchTarget(usage: StyleUsage, target: PatchTarget): void {
  patchTargets.set(usage, target);
}

/**
 * 기록해 둔 구간을 `tokenRef` 그대로(따옴표 없이) 치환하는 패치를 만든다.
 * hardcoded가 아니거나 이 추출기가 만들지 않은 usage는 null.
 */
export function write(usage: StyleUsage, tokenRef: string): WritePatch | null {
  if (usage.source !== "hardcoded") return null;
  const target = patchTargets.get(usage);
  if (target === undefined) return null;
  return { file: target.file, start: target.start, end: target.end, replacement: tokenRef };
}
