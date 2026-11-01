import type { Token } from "../model/token.js";
import type { PropInfo } from "../component/props.js";

export type CatalogOrigin = "ds-local" | "ds-npm" | "init";

/** 타입을 못 읽은 멤버는 type "unknown" */
export interface CatalogProp extends PropInfo {
  type: string;
  required: boolean;
}

export interface CatalogComponent {
  name: string;
  /** 경로: moduleOfFile(root 상대 파일), npm: 패키지명 — 인덱스 ComponentUsage.module과 같은 키 */
  module: string;
  origin: CatalogOrigin;
  /** 선언 파일(root 상대 POSIX). npm은 "node_modules/@mui/material/Button/Button.d.ts" */
  file?: string;
  props: CatalogProp[];
  /** 타입에서 props를 1개 이상 읽었는가 */
  propsStatus: "ok" | "none";
  inherits?: string[];
  description?: string;
  deprecated?: string;
  /** ≤1 */
  examples?: { file: string; code: string }[];
  /** ≤10 */
  tokensUsed?: string[];
}

export interface CatalogSource {
  origin: CatalogOrigin;
  dir?: string;
  packageName?: string;
  packageVersion?: string;
  typesEntry?: string;
}

export interface CatalogToken extends Token {
  file: string;
}

export interface Catalog {
  version: 1;
  dsmith: string;
  sources: CatalogSource[];
  /** 정렬: origin(ds-local·ds-npm → init) → name(코드 단위) → module */
  components: CatalogComponent[];
  tokens: CatalogToken[];
  stats: { components: number; propsOk: number; deprecated: number; tokens: number };
}
