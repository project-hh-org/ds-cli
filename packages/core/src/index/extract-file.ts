import picomatch from "picomatch";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith-dev/extractor-api";

export interface ExtractorMatcher {
  extractor: Extractor;
  /** 파일 경로(root 상대 POSIX)가 이 Extractor의 `files` glob에 맞는지 */
  matches: (file: string) => boolean;
}

/** Extractor마다 glob 매처를 한 번만 컴파일한다. `dot`은 점으로 시작하는 경로 조각(`.hidden/`)까지 맞출지(기본 false). */
export function extractorMatchers(extractors: Extractor[], opts: { dot?: boolean } = {}): ExtractorMatcher[] {
  const dot = opts.dot ?? false;
  return extractors.map((extractor) => ({ extractor, matches: picomatch(extractor.files, { dot }) }));
}

export interface FileStyles {
  styles: StyleUsage[];
  /** glob이 맞고 `appliesTo`도 참이라 `extract`까지 실행한 Extractor 이름 */
  extractorsRun: string[];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 한 파일을 Extractor들로 읽는다(인덱서·가상 파일 검사가 공유). 각 usage의 `file`은 ctx.file로 맞춘다.
 * Extractor가 던지면 `parse(<name>): <msg>` 오류로 다시 던지고, 그 파일의 결과는 하나도 돌려주지 않는다.
 */
export function extractFileStyles(ctx: ExtractContext, matchers: ExtractorMatcher[]): FileStyles {
  const styles: StyleUsage[] = [];
  const extractorsRun: string[] = [];
  for (const { extractor, matches } of matchers) {
    if (!matches(ctx.file)) continue;
    try {
      if (!extractor.appliesTo(ctx)) continue;
      extractorsRun.push(extractor.name);
      for (const usage of extractor.extract(ctx)) {
        // WeakMap 키인 원본 객체를 그대로 유지해야 하므로 복제하지 않고 file만 맞춘다.
        usage.file = ctx.file;
        styles.push(usage);
      }
    } catch (err) {
      throw new Error(`parse(${extractor.name}): ${messageOf(err)}`);
    }
  }
  return { styles, extractorsRun };
}
