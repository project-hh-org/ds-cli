import type { StyleProperty } from "@dsmith-dev/extractor-api";
import type { Token } from "../model/token.js";

export type RuleId = "no-hardcoded-style" | "prefer-ds-component" | "no-deprecated-component";

export interface GuardPolicy {
  /** files: picomatch glob(root 상대) */
  allow: { files: string[]; properties: StyleProperty[] };
  /** replacement 제안 하한 — 이 아래면 replacement는 null */
  minConfidence: "exact" | "close";
  /** guard --ci 임계(초과면 종료 코드 1) */
  failOn: { newHardcoded: number; deprecated: number };
}

export const DEFAULT_GUARD_POLICY: GuardPolicy = Object.freeze({
  allow: Object.freeze({ files: Object.freeze([]) as unknown as string[], properties: Object.freeze([]) as unknown as StyleProperty[] }),
  minConfidence: "close",
  failOn: Object.freeze({ newHardcoded: 0, deprecated: 0 }),
});

export interface DsComponentRef {
  name: string;
  module: string;
  modules?: string[];
  deprecated?: string;
  /** dsmith init이 만든 골격 — 구현 전이라 prefer-ds-component가 권하지 않는다(module은 DS module로는 센다) */
  status?: "scaffold";
}

export interface RuleContext {
  /** 치환 토큰(제안 없음) */
  tokens: Token[];
  ds: { modules: string[]; components: DsComponentRef[] };
  /** decided duplicate: 이 이름은 이 module로 */
  preferred: { name: string; module: string }[];
  policy: GuardPolicy;
}

export interface Finding {
  rule: RuleId;
  file: string;
  line: number;
  /** 0-based(StyleUsage와 같음) */
  column: number;
  message: string;
  /** 입력 usages 배열의 인덱스(ESLint fix가 원본 usage 객체로 write하려고) */
  usageIndex?: number;
  style?: {
    property: StyleProperty;
    raw: string;
    extractor: string;
    category: Token["category"] | null;
    /** 토큰 치환 대상인가: 속성이 COVERAGE_PROPERTIES이고 간격 0이 아님. 아니면 message는 "토큰 치환 대상 아님" */
    eligible: boolean;
    /** tokenIndex: 입력 tokens 배열에서의 위치(O(1) 조회용) */
    replacement: { token: string; value: string; confidence: "exact" | "close"; tokenIndex: number } | null;
  };
  component?: { name: string; module: string; preferModule?: string; deprecated?: string };
}
