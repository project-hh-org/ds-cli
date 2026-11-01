import { extractFileStyles, validateEdit, type ExtractorMatcher } from "@dsmith-dev/core";
import type { StyleUsage } from "@dsmith-dev/extractor-api";

interface Counts {
  hardcoded: number;
  token: number;
  dynamic: number;
}

function countSources(styles: StyleUsage[]): Counts {
  const c: Counts = { hardcoded: 0, token: 0, dynamic: 0 };
  for (const u of styles) {
    if (u.source === "hardcoded") c.hardcoded += 1;
    else if (u.source === "token") c.token += 1;
    else if (u.source === "dynamic") c.dynamic += 1;
  }
  return c;
}

/**
 * 편집 검증: 재파싱(`validateEdit`) + 재추출. 같은 Extractor들로 편집 전·후를 읽어
 * hardcoded가 정확히 n만큼 줄고, token이 n만큼 늘고, dynamic이 그대로여야 한다.
 * 통과하면 null, 아니면 사유. 계획 단계(치환 가능성 확인)와 적용 단계(쓰기 직전)가 같은 함수를 쓴다.
 */
export function checkEdit(
  root: string,
  file: string,
  before: string,
  after: string,
  n: number,
  matchers: ExtractorMatcher[],
): string | null {
  const edit = validateEdit(file, before, after);
  if (!edit.ok) return edit.reason;
  let a: Counts;
  let b: Counts;
  try {
    a = countSources(extractFileStyles({ root, file, code: before }, matchers).styles);
    b = countSources(extractFileStyles({ root, file, code: after }, matchers).styles);
  } catch (err) {
    return `재추출 검증 실패: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (b.hardcoded !== a.hardcoded - n || b.token !== a.token + n || b.dynamic !== a.dynamic) {
    return `재추출 검증 실패: hardcoded ${a.hardcoded}→${b.hardcoded}, token ${a.token}→${b.token}${b.dynamic === a.dynamic ? "" : `, dynamic ${a.dynamic}→${b.dynamic}`}`;
  }
  return null;
}
