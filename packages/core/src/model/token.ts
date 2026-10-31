import type { StyleUsage } from "@ds-cli/extractor-api";

export interface Token {
  name: string;
  value: string;
  normalized: StyleUsage["normalized"];
  category: "color" | "spacing" | "radius" | "font-size";
}

export interface TokenSet {
  source: string;
  tokens: Token[];
}
