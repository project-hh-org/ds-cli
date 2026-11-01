export type StyleProperty =
  | "color"
  | "background-color"
  | "border-color"
  | "fill"
  | "stroke"
  | "padding"
  | "margin"
  | "gap"
  | "width"
  | "height"
  | "font-size"
  | "border-radius"
  | "other";

export type StyleSource = "hardcoded" | "tailwind-default" | "token" | "dynamic";

export interface StyleUsage {
  file: string;
  line: number;
  column: number;
  property: StyleProperty;
  raw: string;
  normalized:
    | { kind: "color"; hex: string; l: number; c: number; h: number }
    | { kind: "length"; px: number }
    | { kind: "unknown" };
  source: StyleSource;
  extractor: string;
}

export interface ExtractContext {
  root: string;
  file: string;
  code: string;
}

export interface WritePatch {
  file: string;
  start: number;
  end: number;
  replacement: string;
}

/** core `Token`과 구조 호환인 토큰 모양. extractor-api는 core를 모르므로 필요한 필드만 구조적으로 선언한다. */
export interface TokenLike {
  name: string;
  value: string;
  category: "color" | "spacing" | "radius" | "font-size";
  normalized: StyleUsage["normalized"];
}

/** `init`이 만든 Tailwind 프리셋 정보(클래스 키 조회용). */
export interface TailwindPreset {
  version: 3 | 4;
  /** root 상대 — v3 "design-system/tailwind.preset.ts"|".cjs", v4 "design-system/tailwind.theme.css" */
  file: string;
  /** tailwind.config의 presets / CSS @import에 연결됐는가 */
  linked: boolean;
  /** CSS 변수 이름("--color-blue-400") → 클래스 키("ds-blue-400") */
  keys: Record<string, string>;
}

export interface TokenRefContext {
  /** 연결된 프리셋만 넘긴다(연결 안 됐으면 undefined) */
  preset?: TailwindPreset;
}

/** Tailwind 프리셋 클래스 키 접두. 기본 테마(`bg-blue-400`, `p-2`)와 이름이 겹치지 않게 한다. */
export const TAILWIND_PRESET_PREFIX = "ds";

const CSS_VAR_NAME = /^--[A-Za-z0-9_-]+$/;

/** name이 CSS 변수 이름이면 `var(${name})`, 아니면 null(CSS 변수가 아닌 토큰은 참조 형식 없음). */
export function cssVarRef(token: TokenLike): string | null {
  return CSS_VAR_NAME.test(token.name) ? `var(${token.name})` : null;
}

/** Extractor가 선언하는 정적 메타. 실행 없이 어떤 파일을 어떻게 읽는지 알 수 있다. */
export interface ExtractorMeta {
  /** "inline-style" | "tailwind" ... 소문자 kebab-case */
  name: string;
  /** 이 Extractor가 읽는 파일 glob. 비어 있으면 안 된다. */
  files: string[];
  /** 소스를 TSX로 파싱하면 "tsx", 파싱하지 않으면 "none" */
  parses: "tsx" | "none";
  /**
   * detect가 이 방식을 감지하는 근거. 하나라도 맞으면 `name`으로 방식을 보고하고, 레지스트리에 있으면 활성화한다.
   * 없으면 detect가 이 Extractor를 감지하지 못한다(내장 6종은 detect 내장 감지가 우선한다).
   */
  signals?: ExtractorSignals;
}

/** detect 감지 근거. 각 항목은 OR로 결합한다. */
export interface ExtractorSignals {
  /** 루트 `package.json`의 dependencies·devDependencies에 있으면 근거가 되는 패키지 이름 */
  dependencies?: string[];
  /** 첫 매칭 파일이 근거가 되는 glob 목록(fast-glob 문법, `!` 부정 패턴은 목록 전체에 적용) */
  files?: string[];
  /** detect가 읽은 JS/TS·CSS/SCSS 소스 내용에 대해 검사할 정규식 소스(플래그 없음) */
  code?: string;
}

export interface Extractor extends ExtractorMeta {
  /** 파일 확장자·내용 기반 빠른 필터 */
  appliesTo(ctx: ExtractContext): boolean;
  extract(ctx: ExtractContext): StyleUsage[];
  write(usage: StyleUsage, tokenRef: string): WritePatch | null;
  /**
   * 이 방식에서 token을 참조하는 문자열(= write의 tokenRef 인자). null이면 이 사용은 참조 형식이 없다(migrate가 no-token-ref로 건너뜀).
   * usage는 이 Extractor의 extract가 만든 객체여야 한다(구간 정보가 필요한 방식이 있다).
   */
  tokenRef?(token: TokenLike, usage: StyleUsage, ctx: TokenRefContext): string | null;
  /** 저장소 루트 기준 사전 준비(설정 파일 로드 등). 파일별 extract 전에 한 번 호출된다. */
  prepare?(root: string): Promise<void> | void;
}

/** JS/TS 소스 파일 glob. 소스 파일을 읽는 Extractor의 공용 `files` 값. */
export const JS_FILES: string[] = ["**/*.{tsx,jsx,ts,js,mjs,cjs}"];

/** Extractor에서 메타(`name`, `files`, `parses`, 있으면 `signals`)만 추려 반환한다. */
export function metaOf(e: Extractor): ExtractorMeta {
  const meta: ExtractorMeta = { name: e.name, files: e.files, parses: e.parses };
  if (e.signals !== undefined) meta.signals = e.signals;
  return meta;
}
