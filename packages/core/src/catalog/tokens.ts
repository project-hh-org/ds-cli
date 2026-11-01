import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadTokens } from "../tokens/load.js";
import type { Catalog, CatalogSource, CatalogToken, CatalogTokenFile } from "./model.js";

const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function hashOf(root: string, file: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await fs.readFile(path.resolve(root, file))).digest("hex");
  } catch {
    return null;
  }
}

export interface CatalogTokensResult {
  tokens: CatalogToken[];
  /** 실제로 읽은 토큰 파일과 그 내용의 sha256 */
  files: CatalogTokenFile[];
  warnings: string[];
  /** 읽지 않는 형식이거나 토큰을 못 읽어 건너뛴 파일 */
  ignored: string[];
}

/**
 * 토큰 파일에서 카탈로그 토큰을 읽는다(audit 제안 토큰 제외). `dsmith ai`와 `dsmith init`의 카탈로그 갱신이 같은 규칙을 쓴다.
 * 정렬: file → name(코드 단위).
 */
export async function readCatalogTokens(root: string, tokenFiles: string[]): Promise<CatalogTokensResult> {
  const loaded = await loadTokens(root, tokenFiles, []);
  const tokens: CatalogToken[] = [];
  for (const t of loaded.tokens) {
    if (t.source !== "token-file" || t.file === undefined) continue;
    tokens.push({
      name: t.name,
      value: t.value,
      normalized: t.normalized,
      category: t.category,
      ...(t.path === undefined ? {} : { path: t.path }),
      file: t.file,
    });
  }
  tokens.sort((a, b) => compareCodeUnits(a.file, b.file) || compareCodeUnits(a.name, b.name));
  const files: CatalogTokenFile[] = [];
  for (const file of [...loaded.files].sort(compareCodeUnits)) {
    const sha256 = await hashOf(root, file);
    if (sha256 !== null) files.push({ file, sha256 });
  }
  return {
    tokens,
    files,
    warnings: loaded.warnings.filter((w) => !w.startsWith("토큰 파일에서 색 토큰")),
    ignored: loaded.ignored,
  };
}

/**
 * 읽은 토큰 파일 해시를 소스에 붙인다(추가 필드). init 산출의 tokens.json은 init 소스, 나머지는 DS 소스(없으면 init 소스)에 붙고
 * 붙일 소스가 없으면 아무것도 하지 않는다. 기존 `tokenFiles`는 새 값으로 교체한다.
 */
export function withTokenFiles(sources: CatalogSource[], files: CatalogTokenFile[], initTokensFile: string | null): CatalogSource[] {
  const init = sources.find((s) => s.origin === "init");
  const ds = sources.find((s) => s.origin !== "init");
  const bucket = new Map<CatalogSource, CatalogTokenFile[]>();
  for (const f of files) {
    const owner = f.file === initTokensFile ? (init ?? ds) : (ds ?? init);
    if (owner === undefined) continue;
    bucket.set(owner, [...(bucket.get(owner) ?? []), f]);
  }
  return sources.map((s) => {
    const { tokenFiles: _drop, ...rest } = s;
    const mine = bucket.get(s);
    return mine === undefined ? rest : { ...rest, tokenFiles: mine };
  });
}

/** 카탈로그에 기록된 토큰 파일 해시 전체(소스 순서·파일 순서) */
export function recordedTokenFiles(catalog: Catalog): CatalogTokenFile[] {
  return catalog.sources.flatMap((s) => (Array.isArray(s.tokenFiles) ? s.tokenFiles : []));
}

/** 기록된 해시와 지금 파일 내용이 다른(또는 없어진) 토큰 파일. 해시를 기록하지 않은 카탈로그는 빈 배열 — 검증할 근거가 없다. */
export async function staleCatalogTokenFiles(root: string, catalog: Catalog): Promise<string[]> {
  const stale: string[] = [];
  for (const rec of recordedTokenFiles(catalog)) {
    if ((await hashOf(root, rec.file)) !== rec.sha256) stale.push(rec.file);
  }
  return stale;
}
