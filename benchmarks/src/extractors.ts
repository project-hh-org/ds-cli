import type { Extractor } from "@dsmith-dev/extractor-api";
import { cssExtractor } from "@dsmith-dev/extractor-css";
import { emotionExtractor } from "@dsmith-dev/extractor-emotion";
import { inlineStyleExtractor } from "@dsmith-dev/extractor-inline-style";
import { muiSxExtractor } from "@dsmith-dev/extractor-mui-sx";
import { styledExtractor } from "@dsmith-dev/extractor-styled";
import { tailwindExtractor } from "@dsmith-dev/extractor-tailwind";

/**
 * 스냅샷(`.dsmith/guard.json`)의 extractors 이름 → Extractor. cli `registry`·eslint-plugin `BUILTIN_EXTRACTORS`와 키가 같다
 * (둘 다 패키지 밖으로 export되지 않아 이름표를 따로 둔다 — test/prompts.test.ts가 키 6개를 고정).
 */
export const BUILTIN_EXTRACTORS: Record<string, Extractor> = {
  "inline-style": inlineStyleExtractor,
  tailwind: tailwindExtractor,
  css: cssExtractor,
  styled: styledExtractor,
  emotion: emotionExtractor,
  "mui-sx": muiSxExtractor,
};

/** 이름 목록 → Extractor(순서 유지). 모르는 이름은 Error. */
export function extractorsFor(names: string[]): Extractor[] {
  return names.map((name) => {
    const e = Object.hasOwn(BUILTIN_EXTRACTORS, name) ? BUILTIN_EXTRACTORS[name] : undefined;
    if (e === undefined) throw new Error(`알 수 없는 Extractor: ${name}`);
    return e;
  });
}
