import { extractComponentUsage, extractFileStyles, parseTsx, validateEdit, type ExtractorMatcher } from "@dsmith-dev/core";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import type { ModuleEnv } from "./components.js";

/**
 * 컴포넌트 import를 옮긴 파일의 재검증: 편집 뒤 그 파일의 `item` 사용(JSX)이 전부 기대한 module에서 와야 한다.
 * 지역 선언(declaredLocally)과 import 없는 사용(module "")은 보지 않는다. 통과하면 null, 아니면 사유
 */
export function checkComponents(file: string, after: string, checks: { item: string; module: string }[], env: ModuleEnv): string | null {
  if (checks.length === 0) return null;
  let usages;
  try {
    usages = extractComponentUsage(file, parseTsx(after, file), env.tsPaths, env.moduleContext);
  } catch (err) {
    return `컴포넌트 재추출 검증 실패: ${err instanceof Error ? err.message : String(err)}`;
  }
  for (const { item, module } of checks) {
    for (const u of usages) {
      if (u.name !== item || u.declaredLocally === true || u.module === "") continue;
      if (u.module !== module) return `컴포넌트 재추출 검증 실패: ${item}(${u.line}줄)이 ${u.module}에서 옴(기대 ${module})`;
    }
  }
  return null;
}

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
