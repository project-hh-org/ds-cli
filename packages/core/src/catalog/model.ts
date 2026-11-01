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
  /** 사용 수 조인용 모듈 키 전체: `module` + DS 디렉터리의 index.* 배럴 중 이 이름을 re-export하는 것의 module. 배럴이 없으면 생략 */
  modules?: string[];
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
  /** "scaffold": dsmith init이 만든 뒤 아직 손대지 않은 골격(구현 전). 없으면 실제 구현 */
  status?: "scaffold";
}

/** `dsmith ai`가 읽은 토큰 파일의 내용 해시 — 이 해시가 어긋나면 카탈로그 토큰은 낡은 것이다 */
export interface CatalogTokenFile {
  file: string;
  sha256: string;
}

export interface CatalogSource {
  origin: CatalogOrigin;
  dir?: string;
  packageName?: string;
  packageVersion?: string;
  typesEntry?: string;
  /** 이 소스의 토큰 파일과 해시(추가 필드 — 없으면 신선도를 검증하지 않는다) */
  tokenFiles?: CatalogTokenFile[];
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
