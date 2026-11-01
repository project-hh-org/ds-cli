import type { Extractor, StyleUsage, TokenLike, TokenRefContext } from "./extractor.js";

/** write+tokenRef 왕복 케이스: 치환 뒤 재추출하면 그 사용만 바뀌어야 한다. */
export interface WriteCase {
  /** 원 usage를 고르는 부분 매칭(첫 일치) */
  target: Partial<StyleUsage>;
  token: TokenLike;
  ctx?: TokenRefContext;
  /** tokenRef 기대값. null이면 null이어야 하고 이후 검사는 생략한다 */
  ref: string | null;
  /** 패치 적용 뒤 전체 코드 기대값(선택) */
  output?: string;
  /** 재추출 시 target.line과 같은 줄에 있어야 하는 usage(보통 { source: "token", property }) */
  reextract: Partial<StyleUsage>;
}

export interface ConformanceCase {
  code: string;
  file: string;
  expect: Partial<StyleUsage>[];
  writes?: WriteCase[];
}

export interface ConformanceReport {
  passed: number;
  failed: { case: number; reason: string }[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `toMatchObject` 의미의 deep partial 매칭: 객체는 부분 집합, 배열은 길이 동일 + 원소별 부분 매칭, 나머지는 `Object.is`. */
function matchesPartial(actual: unknown, partial: unknown): boolean {
  if (isPlainObject(partial)) {
    if (!isPlainObject(actual)) return false;
    return Object.entries(partial).every(([key, value]) => matchesPartial(actual[key], value));
  }
  if (Array.isArray(partial)) {
    return (
      Array.isArray(actual) &&
      actual.length === partial.length &&
      partial.every((value, i) => matchesPartial(actual[i], value))
    );
  }
  return Object.is(actual, partial);
}

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** 메타 계약 위반 사유 목록. 정상이면 빈 배열. */
function metaProblems(extractor: Extractor): string[] {
  const problems: string[] = [];
  if (typeof extractor.name !== "string" || !NAME_PATTERN.test(extractor.name)) {
    problems.push(`name은 ${NAME_PATTERN} 형식이어야 함: ${JSON.stringify(extractor.name)}`);
  }
  if (!Array.isArray(extractor.files) || extractor.files.length === 0) {
    problems.push("files가 비어 있음");
  }
  if (extractor.parses !== "tsx" && extractor.parses !== "none") {
    problems.push(`parses는 "tsx" | "none"이어야 함: ${JSON.stringify(extractor.parses)}`);
  }
  if (extractor.signals !== undefined) problems.push(...signalsProblems(extractor.signals));
  return problems;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v !== "");
}

/** `signals` 모양 검사: 항목이 하나 이상, dependencies·files는 비지 않은 문자열 배열, code는 컴파일되는 정규식 소스. */
function signalsProblems(signals: unknown): string[] {
  if (!isPlainObject(signals)) return [`signals는 객체여야 함: ${JSON.stringify(signals)}`];
  const problems: string[] = [];
  const { dependencies, files, code } = signals;
  if (dependencies === undefined && files === undefined && code === undefined) {
    problems.push("signals에 dependencies·files·code 중 하나는 있어야 함");
  }
  if (dependencies !== undefined && !isNonEmptyStringArray(dependencies)) {
    problems.push(`signals.dependencies는 비지 않은 문자열 배열이어야 함: ${JSON.stringify(dependencies)}`);
  }
  if (files !== undefined && !isNonEmptyStringArray(files)) {
    problems.push(`signals.files는 비지 않은 문자열 배열이어야 함: ${JSON.stringify(files)}`);
  }
  if (code !== undefined) {
    if (typeof code !== "string" || code === "") {
      problems.push(`signals.code는 비지 않은 정규식 소스 문자열이어야 함: ${JSON.stringify(code)}`);
    } else {
      try {
        new RegExp(code);
      } catch (error) {
        problems.push(`signals.code가 정규식으로 컴파일되지 않음: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return problems;
}

/** 다중집합 비교용 키. */
function multiset(usages: StyleUsage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const u of usages) {
    const key = `${u.property}|${u.raw}|${u.source}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sameMultiset(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, n] of a) if (b.get(key) !== n) return false;
  return true;
}

function checkWrite(extractor: Extractor, testCase: ConformanceCase, wc: WriteCase, label: string): string | null {
  const extractAll = (code: string): StyleUsage[] => extractor.extract({ root: "/", file: testCase.file, code });
  let before: StyleUsage[];
  try {
    before = extractAll(testCase.code);
  } catch (error) {
    return `${label}: extract가 예외를 던짐: ${error instanceof Error ? error.message : String(error)}`;
  }
  const target = before.find((u) => matchesPartial(u, wc.target));
  if (target === undefined) return `${label}: target과 일치하는 usage가 없음: ${JSON.stringify(wc.target)}`;

  const ref = extractor.tokenRef!(wc.token, target, wc.ctx ?? {});
  if (ref !== wc.ref) return `${label}: tokenRef가 ${JSON.stringify(wc.ref)}이어야 하는데 ${JSON.stringify(ref)}`;
  if (wc.ref === null || ref === null) return null;

  const patch = extractor.write(target, ref);
  if (patch === null) return `${label}: write가 null을 돌려줌`;
  const after = testCase.code.slice(0, patch.start) + patch.replacement + testCase.code.slice(patch.end);
  if (wc.output !== undefined && after !== wc.output) {
    return `${label}: 패치 적용 결과가 output과 다름: ${JSON.stringify(after)}`;
  }

  let reextracted: StyleUsage[];
  try {
    reextracted = extractAll(after);
  } catch (error) {
    return `${label}: 치환 뒤 재추출이 예외를 던짐: ${error instanceof Error ? error.message : String(error)}`;
  }
  const replaced = reextracted.find((u) => u.line === target.line && matchesPartial(u, wc.reextract));
  if (replaced === undefined) {
    return `${label}: 재추출에서 ${target.line}번 줄에 reextract와 일치하는 usage가 없음: ${JSON.stringify(wc.reextract)}`;
  }

  const rest = multiset(before);
  const key = `${target.property}|${target.raw}|${target.source}`;
  rest.set(key, (rest.get(key) ?? 1) - 1);
  if (rest.get(key) === 0) rest.delete(key);
  const restAfter = multiset(reextracted.filter((u) => u !== replaced));
  if (!sameMultiset(rest, restAfter)) return `${label}: 치환 대상 외의 usage가 바뀜`;
  return null;
}

function checkCase(extractor: Extractor, testCase: ConformanceCase): string | null {
  let usages: StyleUsage[];
  try {
    usages = extractor.extract({ root: "/", file: testCase.file, code: testCase.code });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `extract가 예외를 던짐: ${message}`;
  }

  if (testCase.expect.length > 0 && usages.length === 0) {
    return "추출 결과가 비어 있음 (nothing extracted)";
  }

  for (const [index, partial] of testCase.expect.entries()) {
    if (!usages.some((usage) => matchesPartial(usage, partial))) {
      return `expect[${index}]와 일치하는 usage가 없음: ${JSON.stringify(partial)}`;
    }
  }

  if (testCase.writes !== undefined && testCase.writes.length > 0) {
    if (extractor.tokenRef === undefined) return "tokenRef 없음";
    for (const [index, wc] of testCase.writes.entries()) {
      const reason = checkWrite(extractor, testCase, wc, `writes[${index}]`);
      if (reason !== null) return reason;
    }
  }
  return null;
}

/**
 * Extractor 구현체가 계약을 지키는지 동기적으로 검사한다. vitest `it`를 등록하지 않고 결과만 돌려준다.
 * 케이스마다 `make()`로 새 인스턴스를 만들어 케이스 간 상태 공유를 막는다.
 * 케이스 실행 전에 메타(name·files·parses, 있으면 signals)를 먼저 검사하며, 위반은 `case: -1`로 기록하되 케이스는 계속 실행한다.
 * 메타는 첫 케이스용 인스턴스로 검사하고(케이스가 없으면 `make()`를 한 번 호출), 인스턴스 수는 케이스 수와 같다.
 */
export function runConformance(
  name: string,
  make: () => Extractor,
  cases: ConformanceCase[],
): ConformanceReport {
  const report: ConformanceReport = { passed: 0, failed: [] };
  const fail = (index: number, reason: string): void => {
    report.failed.push({ case: index, reason: `[${name}] ${reason}` });
  };

  const checkMeta = (extractor: Extractor): void => {
    for (const problem of metaProblems(extractor)) fail(-1, `meta: ${problem}`);
  };

  if (cases.length === 0) {
    checkMeta(make());
    return report;
  }

  cases.forEach((testCase, index) => {
    const extractor = make();
    if (index === 0) checkMeta(extractor);
    const reason = checkCase(extractor, testCase);
    if (reason === null) {
      report.passed++;
    } else {
      fail(index, reason);
    }
  });
  return report;
}
