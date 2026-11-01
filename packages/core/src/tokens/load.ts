import fs from "node:fs/promises";
import path from "node:path";
import type { StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
import type { Token } from "../model/token.js";
import { collectCssVariables, readCssVariableTokens } from "./css-variables.js";
import { proposalTokens } from "./proposal.js";

/** "catalog"는 3b가 채운다. */
export type TokenSourceKind = "token-file" | "proposal" | "catalog";

export interface LoadedToken extends Token {
  /** 이 토큰이 어디서 왔는지 — 토큰 파일에서 읽었는지, audit 클러스터에서 제안했는지 */
  source: "token-file" | "proposal";
}

export interface LoadedTokens {
  /** 요약: 전부 파일이면 "token-file", 전부 제안이면 "proposal", 섞이면 "mixed". 토큰별 출처는 `tokens[].source` */
  source: "token-file" | "proposal" | "mixed";
  tokens: LoadedToken[];
  /** 실제로 읽은 토큰 파일 */
  files: string[];
  /** 3a가 읽지 않는 형식(.ts/.js/.json)이라 건너뛴 detect.ds.tokenFiles */
  ignored: string[];
  /** 읽지 못한 파일, 색 토큰이 없다는 알림 등 */
  warnings: string[];
}

const CSS_FILE = /\.(css|scss)$/i;
const CATEGORIES: Token["category"][] = ["color", "spacing", "radius", "font-size"];

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
 * DS 토큰 파일(.css/.scss)에서 토큰을 읽고, 파일에 토큰이 하나도 없는 카테고리는 audit 제안 토큰으로 채운다.
 * 같은 이름이 여러 파일에 있으면 먼저 나온 파일이 이긴다. var() 참조는 모든 파일에 걸쳐 푼다.
 * 3b 훅: .json(W3C) 토큰은 지금 ignored이며, 3b가 여기에 분기를 추가한다.
 */
export async function loadTokens(
  root: string,
  tokenFiles: string[],
  styles: StyleUsage[],
): Promise<LoadedTokens> {
  const files: string[] = [];
  const ignored: string[] = [];
  const warnings: string[] = [];
  const sources: { file: string; code: string }[] = [];

  for (const file of tokenFiles) {
    if (!CSS_FILE.test(file)) {
      ignored.push(file);
      continue;
    }
    try {
      sources.push({ file, code: await fs.readFile(path.resolve(root, file), "utf8") });
      files.push(file);
    } catch {
      warnings.push(`토큰 파일을 읽을 수 없음: ${file}`);
    }
  }

  const aliases = new Map<string, string>();
  for (const { code, file } of sources) {
    for (const [name, value] of collectCssVariables(code, file)) {
      if (!aliases.has(name)) aliases.set(name, value);
    }
  }

  const tokens: LoadedToken[] = [];
  const seen = new Set<string>();
  for (const { code, file } of sources) {
    for (const token of readCssVariableTokens(code, file, aliases)) {
      if (seen.has(token.name)) continue;
      seen.add(token.name);
      tokens.push({ ...token, source: "token-file" });
    }
  }

  if (files.length > 0 && !tokens.some((t) => t.category === "color")) {
    warnings.push("토큰 파일에서 색 토큰을 찾지 못함");
  }

  const fromFile = new Set(tokens.map((t) => t.category));
  const proposals = proposalTokens(styles).filter((t) => !fromFile.has(t.category));
  for (const category of CATEGORIES) {
    for (const token of proposals) {
      if (token.category === category) tokens.push({ ...token, source: "proposal" });
    }
  }

  const proposed = tokens.filter((t) => t.source === "proposal").length;
  const source = proposed === 0 && tokens.length > 0 ? "token-file" : proposed === tokens.length ? "proposal" : "mixed";
  return { source, tokens, files, ignored, warnings };
}
