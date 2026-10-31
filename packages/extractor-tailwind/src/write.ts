import type { StyleUsage, WritePatch } from "@dsmith/extractor-api";

/** 치환할 클래스 토큰의 소스 구간(variant 접두 포함)과 보존할 variant 목록. */
interface PatchTarget {
  start: number;
  end: number;
  file: string;
  variants: readonly string[];
  important: "prefix" | "suffix" | null;
}

const patchTargets = new WeakMap<StyleUsage, PatchTarget>();

/** extract가 클래스 토큰 usage를 만들 때 호출해 치환 구간을 기록한다. */
export function registerPatchTarget(usage: StyleUsage, target: PatchTarget): void {
  patchTargets.set(usage, target);
}

/**
 * 기록해 둔 클래스 토큰 하나를 `[variants:]tokenRef`로 치환하는 패치를 만든다.
 * variant 접두(`md:`, `hover:` 등)와 important `!`는 보존한다. `-mt-2`처럼 음수 접두가 있었다면 `tokenRef`가 그 의미를 담아야 한다.
 * dynamic·token 소스 usage나 이 추출기가 만들지 않은 usage는 null.
 */
export function write(usage: StyleUsage, tokenRef: string): WritePatch | null {
  if (usage.source === "dynamic" || usage.source === "token") return null;
  const target = patchTargets.get(usage);
  if (target === undefined) return null;
  // tokenRef가 곧 유틸리티 전체다. `-mt-2` 같은 음수 부호는 호출자가 tokenRef에 담는다.
  const body = target.important === "prefix" ? `!${tokenRef}` : tokenRef;
  const important = target.important === "suffix" ? "!" : "";
  const replacement = [...target.variants, `${body}${important}`].join(":");
  return { file: target.file, start: target.start, end: target.end, replacement };
}
