import type { Extractor, StyleUsage } from "./extractor.js";

export interface ConformanceCase {
  code: string;
  file: string;
  expect: Partial<StyleUsage>[];
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
