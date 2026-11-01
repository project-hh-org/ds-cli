import fs from "node:fs/promises";
import path from "node:path";
import { readCatalog } from "../catalog/store.js";
import { staleCatalogTokenFiles } from "../catalog/tokens.js";
import { findInitDir } from "../fs/init-dir.js";
import { loadTokens, tokensFromCatalog, type LoadedToken } from "./load.js";

export interface ReplacementTokens {
  source: "token-file" | "catalog" | "none";
  /** 제안(proposal) 토큰은 없다 */
  tokens: LoadedToken[];
  /** 읽은 토큰 파일(또는 카탈로그 토큰의 file 합집합) */
  files: string[];
  /** 치환 대상에서 뺄 파일: 읽은 토큰 파일 전부 */
  excludeFiles: string[];
  /** 치환 대상에서 뺄 디렉터리: init 산출 디렉터리(`findInitDir`)가 있으면 [그것] */
  excludeDirs: string[];
  warnings: string[];
}

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isFile();
  } catch {
    return false;
  }
}

/**
 * 마이그레이션이 치환에 쓸 토큰. 토큰 파일 > 카탈로그, audit 제안 토큰은 어떤 경우에도 쓰지 않는다.
 * 1) tokenFiles = detect의 `ds.tokenFiles` ∪ (init 산출 디렉터리에 있는 `tokens.css`·`tokens.json`) — init 직후 detect.json이 낡아도 init 토큰을 찾는다
 * 2) 그중 읽은 토큰 파일의 토큰이 1개 이상이면 "token-file"
 * 3) 아니면 `.dsmith/catalog.json`의 토큰(기록된 토큰 파일 해시가 지금과 같을 때만) → "catalog"
 * 4) 아니면 "none"
 */
export async function loadReplacementTokens(root: string, detectTokenFiles: string[]): Promise<ReplacementTokens> {
  const initDir = await findInitDir(root);
  const excludeDirs = initDir === null ? [] : [initDir];
  const tokenFiles = [...detectTokenFiles];
  if (initDir !== null) {
    for (const name of ["tokens.css", "tokens.json"]) {
      const rel = initDir === "." ? name : `${initDir}/${name}`;
      if (!tokenFiles.includes(rel) && (await isFile(path.resolve(root, rel)))) tokenFiles.push(rel);
    }
  }

  const loaded = await loadTokens(root, tokenFiles, []);
  const fromFiles = loaded.tokens.filter((t) => t.source === "token-file");
  if (fromFiles.length > 0) {
    return {
      source: "token-file",
      tokens: fromFiles,
      files: loaded.files,
      excludeFiles: [...loaded.files],
      excludeDirs,
      warnings: loaded.warnings,
    };
  }

  const warnings = [...loaded.warnings];
  try {
    const catalog = await readCatalog(root);
    if (catalog !== null && catalog.tokens.length > 0) {
      const stale = await staleCatalogTokenFiles(root, catalog);
      if (stale.length === 0) {
        const fromCatalog = tokensFromCatalog(catalog.tokens, []);
        return {
          source: "catalog",
          tokens: fromCatalog.tokens.filter((t) => t.source === "catalog"),
          files: fromCatalog.files,
          excludeFiles: [...fromCatalog.files],
          excludeDirs,
          warnings,
        };
      }
      warnings.push(`카탈로그의 토큰 파일이 바뀌어 토큰을 쓰지 않음: ${stale.join(", ")} (dsmith ai로 갱신)`);
    }
  } catch (err) {
    warnings.push((err as Error).message);
  }
  return { source: "none", tokens: [], files: [], excludeFiles: [], excludeDirs, warnings };
}
