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

export interface Extractor {
  /** "inline-style" | "tailwind" ... */
  name: string;
  /** 파일 확장자·내용 기반 빠른 필터 */
  appliesTo(ctx: ExtractContext): boolean;
  extract(ctx: ExtractContext): StyleUsage[];
  write(usage: StyleUsage, tokenRef: string): WritePatch | null;
}
