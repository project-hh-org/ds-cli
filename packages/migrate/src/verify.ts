import { extractComponentUsage, extractFileStyles, parseTsx, shorthandColorProperty, validateEdit, type ExtractorMatcher } from "@dsmith-dev/core";
import type { StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
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
      // 가져온 원래 이름으로 맞춘다(별칭 `Button as Btn`의 사용은 name이 Btn, imported가 Button)
      if ((u.imported ?? u.name) !== item || u.declaredLocally === true) continue;
      if (u.module === "") return `컴포넌트 재추출 검증 실패: ${item}(${u.line}줄)의 import를 찾을 수 없음(기대 ${module})`;
      if (u.module !== module) return `컴포넌트 재추출 검증 실패: ${item}(${u.line}줄)이 ${u.module}에서 옴(기대 ${module})`;
    }
  }
  return null;
}

interface Counts {
  hardcoded: number;
  token: number;
  dynamic: number;
  /** 속성별 source 수 */
  byProperty: Map<string, { hardcoded: number; token: number; dynamic: number }>;
}

/** 단축 속성 라벨(`background`·`border` …)은 승격된 색 속성(`background-color`·`border-color`)과 같은 속성으로 본다 */
const canonical = (property: string): string => shorthandColorProperty(property) ?? property;

function countSources(styles: StyleUsage[]): Counts {
  const c: Counts = { hardcoded: 0, token: 0, dynamic: 0, byProperty: new Map() };
  for (const u of styles) {
    if (u.source !== "hardcoded" && u.source !== "token" && u.source !== "dynamic") continue;
    c[u.source] += 1;
    const key = canonical(u.property);
    const p = c.byProperty.get(key) ?? { hardcoded: 0, token: 0, dynamic: 0 };
    p[u.source] += 1;
    c.byProperty.set(key, p);
  }
  return c;
}

/**
 * 편집 검증: 재파싱(`validateEdit`) + 재추출. 같은 Extractor들로 편집 전·후를 읽어
 * 계획한 치환(`expected` = 치환마다 원래 사용의 속성 하나)만큼 hardcoded가 줄고 token이 늘며 dynamic이 그대로여야 하고,
 * 그 변화가 **속성별로도** 맞아야 한다(치환한 사용이 같은 속성의 token이 됨, 다른 속성의 사용은 그대로).
 * 통과하면 null, 아니면 사유. 계획 단계(치환 가능성 확인)와 적용 단계(쓰기 직전)가 같은 함수를 쓴다.
 */
export function checkEdit(
  root: string,
  file: string,
  before: string,
  after: string,
  expected: readonly StyleProperty[],
  matchers: ExtractorMatcher[],
): string | null {
  const edit = validateEdit(file, before, after);
  if (!edit.ok) return edit.reason;
  const n = expected.length;
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
  const moved = new Map<string, number>();
  for (const p of expected) moved.set(canonical(p), (moved.get(canonical(p)) ?? 0) + 1);
  const zero = { hardcoded: 0, token: 0, dynamic: 0 };
  const wrong: string[] = [];
  for (const key of new Set([...a.byProperty.keys(), ...b.byProperty.keys(), ...moved.keys()])) {
    const x = a.byProperty.get(key) ?? zero;
    const y = b.byProperty.get(key) ?? zero;
    const m = moved.get(key) ?? 0;
    if (y.hardcoded !== x.hardcoded - m || y.token !== x.token + m || y.dynamic !== x.dynamic) {
      wrong.push(`${key} hardcoded ${x.hardcoded}→${y.hardcoded}, token ${x.token}→${y.token}${y.dynamic === x.dynamic ? "" : `, dynamic ${x.dynamic}→${y.dynamic}`} (기대: hardcoded −${m}, token +${m})`);
    }
  }
  return wrong.length === 0 ? null : `재추출 검증 실패: 속성이 달라짐 — ${wrong.join("; ")}`;
}
