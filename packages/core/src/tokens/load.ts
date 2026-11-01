import fs from "node:fs/promises";
import path from "node:path";
import type { StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
import type { Token } from "../model/token.js";
import { readCssVariableTokens } from "./css-variables.js";
import { proposalTokens } from "./proposal.js";

/** "catalog"는 3b가 채운다. */
export type TokenSourceKind = "token-file" | "proposal" | "catalog";

export interface LoadedTokens {
  source: TokenSourceKind;
  tokens: Token[];
  /** 실제로 읽은 토큰 파일 */
  files: string[];
  /** 3a가 읽지 않는 형식(.ts/.js/.json)이라 건너뛴 detect.ds.tokenFiles */
  ignored: string[];
}

const CSS_FILE = /\.(css|scss)$/i;

export function tokenCategoryOf(property: StyleProperty): Token["category"] | null {
  switch (property) {
    case "color":
    case "background-color":
    case "border-color":
    case "fill":
    case "stroke":
      return "color";
    case "padding":
    case "margin":
    case "gap":
    case "width":
    case "height":
      return "spacing";
    case "border-radius":
      return "radius";
    case "font-size":
      return "font-size";
    default:
      return null;
  }
}

/**
 * DS 토큰 파일(.css/.scss)에서 토큰을 읽고, 토큰이 하나도 없으면 audit 제안 토큰으로 대체한다.
 * 3b 훅: .json(W3C) 토큰은 지금 ignored이며, 3b가 여기에 분기를 추가한다.
 */
export async function loadTokens(
  root: string,
  tokenFiles: string[],
  styles: StyleUsage[],
): Promise<LoadedTokens> {
  const files: string[] = [];
  const ignored: string[] = [];
  const tokens: Token[] = [];

  for (const file of tokenFiles) {
    if (!CSS_FILE.test(file)) {
      ignored.push(file);
      continue;
    }
    let code: string;
    try {
      code = await fs.readFile(path.resolve(root, file), "utf8");
    } catch {
      continue;
    }
    files.push(file);
    tokens.push(...readCssVariableTokens(code, file));
  }

  if (tokens.length > 0) return { source: "token-file", tokens, files, ignored };
  return { source: "proposal", tokens: proposalTokens(styles), files, ignored };
}
