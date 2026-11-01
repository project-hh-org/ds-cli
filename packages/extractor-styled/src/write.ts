import type { StyleUsage, WritePatch } from "@dsmith/extractor-api";

/** 치환할 소스 구간. `quote`면 JS 문자열 리터럴 자리(객체 문법 값)라 `tokenRef`를 따옴표로 감싼다. */
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
 * 기록해 둔 구간을 치환하는 패치를 만든다. 템플릿 값은 `tokenRef` 그대로, 객체 문법 값은 `JSON.stringify(tokenRef)`.
 * hardcoded가 아니거나 이 패키지가 만들지 않은 usage는 null.
 */
export function write(usage: StyleUsage, tokenRef: string): WritePatch | null {
  if (usage.source !== "hardcoded") return null;
  const target = patchTargets.get(usage);
  if (target === undefined) return null;
  return {
    file: target.file,
    start: target.start,
    end: target.end,
    replacement: target.quote ? JSON.stringify(tokenRef) : tokenRef,
  };
}
