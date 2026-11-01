import type { Extractor } from "@dsmith-dev/extractor-api";
import { cssExtractor } from "@dsmith-dev/extractor-css";
import { emotionExtractor } from "@dsmith-dev/extractor-emotion";
import { inlineStyleExtractor } from "@dsmith-dev/extractor-inline-style";
import { muiSxExtractor } from "@dsmith-dev/extractor-mui-sx";
import { styledExtractor } from "@dsmith-dev/extractor-styled";
import { tailwindExtractor } from "@dsmith-dev/extractor-tailwind";

/**
 * 스냅샷(`.dsmith/guard.json`)의 extractors 이름 → Extractor. 플러그인은 cli 레지스트리를 모르므로 내장 6종을 직접 갖는다.
 * 키 목록은 cli `registry`와 같아야 한다(cli/test/registry.test.ts가 고정).
 */
export const BUILTIN_EXTRACTORS: Record<string, Extractor> = {
  "inline-style": inlineStyleExtractor,
  tailwind: tailwindExtractor,
  css: cssExtractor,
  styled: styledExtractor,
  emotion: emotionExtractor,
  "mui-sx": muiSxExtractor,
};
