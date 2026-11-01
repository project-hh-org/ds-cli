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

export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  allow: { files: [], properties: [] },
  minConfidence: "close",
  failOn: { newHardcoded: 0, deprecated: 0 },
};

export interface DsComponentRef {
  name: string;
  module: string;
  modules?: string[];
  deprecated?: string;
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
    replacement: { token: string; value: string; confidence: "exact" | "close" } | null;
  };
  component?: { name: string; module: string; preferModule?: string; deprecated?: string };
}
