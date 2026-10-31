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

function checkCase(make: () => Extractor, testCase: ConformanceCase): string | null {
  let usages: StyleUsage[];
  try {
    usages = make().extract({ root: "/", file: testCase.file, code: testCase.code });
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
 */
export function runConformance(
  name: string,
  make: () => Extractor,
  cases: ConformanceCase[],
): ConformanceReport {
  const report: ConformanceReport = { passed: 0, failed: [] };
  cases.forEach((testCase, index) => {
    const reason = checkCase(make, testCase);
    if (reason === null) {
      report.passed++;
    } else {
      report.failed.push({ case: index, reason: `[${name}] ${reason}` });
    }
  });
  return report;
}
