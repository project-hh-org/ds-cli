import type { Extractor } from "@ds-cli/extractor-api";
import { inlineStyleExtractor } from "@ds-cli/extractor-inline-style";
import { tailwindExtractor } from "@ds-cli/extractor-tailwind";

/** detect.activeExtractors의 이름 → Extractor. 키는 Extractor.name과 같아야 한다. */
export const registry: Record<string, () => Extractor> = {
  "inline-style": () => inlineStyleExtractor,
  tailwind: () => tailwindExtractor,
};

/** 이름 목록으로 Extractor를 만든다. 레지스트리에 없는 이름은 stderr에 경고하고 건너뛴다. */
export function buildExtractors(names: string[]): Extractor[] {
  const extractors: Extractor[] = [];
  for (const name of names) {
    const factory = Object.hasOwn(registry, name) ? registry[name] : undefined;
    if (factory === undefined) {
      process.stderr.write(`경고: 알 수 없는 Extractor "${name}"를 건너뜁니다.\n`);
      continue;
    }
    extractors.push(factory());
  }
  return extractors;
}
