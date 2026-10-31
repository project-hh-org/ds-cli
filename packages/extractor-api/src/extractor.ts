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

/** Extractor가 선언하는 정적 메타. 실행 없이 어떤 파일을 어떻게 읽는지 알 수 있다. */
export interface ExtractorMeta {
  /** "inline-style" | "tailwind" ... 소문자 kebab-case */
  name: string;
  /** 이 Extractor가 읽는 파일 glob. 비어 있으면 안 된다. */
  files: string[];
  /** 소스를 TSX로 파싱하면 "tsx", 파싱하지 않으면 "none" */
  parses: "tsx" | "none";
}

export interface Extractor extends ExtractorMeta {
  /** 파일 확장자·내용 기반 빠른 필터 */
  appliesTo(ctx: ExtractContext): boolean;
  extract(ctx: ExtractContext): StyleUsage[];
  write(usage: StyleUsage, tokenRef: string): WritePatch | null;
  /** 저장소 루트 기준 사전 준비(설정 파일 로드 등). 파일별 extract 전에 한 번 호출된다. */
  prepare?(root: string): Promise<void> | void;
}

/** JS/TS 소스 파일 glob. 소스 파일을 읽는 Extractor의 공용 `files` 값. */
export const JS_FILES: string[] = ["**/*.{tsx,jsx,ts,js,mjs,cjs}"];

/** Extractor에서 메타(`name`, `files`, `parses`)만 추려 반환한다. */
export function metaOf(e: Extractor): ExtractorMeta {
  return { name: e.name, files: e.files, parses: e.parses };
}
