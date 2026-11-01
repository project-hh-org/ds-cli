import type { StyleUsage } from "@dsmith-dev/extractor-api";

export interface Token {
  name: string;
  value: string;
  normalized: StyleUsage["normalized"];
  category: "color" | "spacing" | "radius" | "font-size";
  /** W3C 토큰의 DTCG 경로("color.blue-400"). CSS 변수에서 읽은 토큰은 없다 */
  path?: string;
}

export interface TokenSet {
  source: string;
  tokens: Token[];
}
