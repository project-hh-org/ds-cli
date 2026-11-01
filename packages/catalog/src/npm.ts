import fs from "node:fs/promises";
import path from "node:path";
import type { CatalogComponent, CatalogSource, Index } from "@dsmith-dev/core";
import { componentsFromDts } from "./dts.js";
import { toCatalogProp } from "./names.js";

export interface PackageTypes {
  /** 타입 엔트리(절대 경로) */
  entry: string;
  /** root 상대 POSIX 경로 */
  entryRel: string;
  version?: string;
}

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isFile();
  } catch {
    return false;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** exports["."]에서 types를 찾는 순서: types(문자열) → import.types → require.types → default.types */
function exportsTypes(exp: unknown): string[] {
  const dot = asRecord(exp)?.["."];
  const rec = asRecord(dot);
  if (!rec) return [];
  const out: string[] = [];
  if (typeof rec.types === "string") out.push(rec.types);
  for (const cond of ["import", "require", "default"]) {
    const inner = asRecord(rec[cond]);
    if (inner && typeof inner.types === "string") out.push(inner.types);
  }
  return out;
}

/**
 * `<root>/node_modules/<pkg>/package.json`의 타입 엔트리:
 * exports["."]의 types → import.types → require.types → default.types → types → typings → index.d.ts. 없으면 null
 */
export async function resolvePackageTypes(root: string, pkg: string): Promise<PackageTypes | null> {
  const pkgDir = path.join(root, "node_modules", ...pkg.split("/"));
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(await fs.readFile(path.join(pkgDir, "package.json"), "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const declared = [
    ...exportsTypes(json.exports),
    ...(typeof json.types === "string" ? [json.types] : []),
    ...(typeof json.typings === "string" ? [json.typings] : []),
    "./index.d.ts",
  ];
  for (const d of declared) {
    const abs = path.resolve(pkgDir, d);
    const rel = path.relative(pkgDir, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (await isFile(abs)) {
      const out: PackageTypes = {
        entry: abs,
        entryRel: path.relative(root, abs).split(path.sep).join("/"),
      };
      if (typeof json.version === "string") out.version = json.version;
      return out;
    }
  }
  return null;
}

export async function catalogFromPackage(
  root: string,
  pkg: string,
  _index: Index,
): Promise<{ components: CatalogComponent[]; source: CatalogSource; warnings: string[] }> {
  const source: CatalogSource = { origin: "ds-npm", packageName: pkg };
  const types = await resolvePackageTypes(root, pkg);
  if (!types) {
    const installed = await isFile(path.join(root, "node_modules", ...pkg.split("/"), "package.json"));
    return {
      components: [],
      source,
      warnings: [
        installed
          ? `node_modules/${pkg}의 타입 엔트리를 찾지 못함`
          : `node_modules/${pkg} 없음 — 의존성 설치 후 다시 실행`,
      ],
    };
  }
  if (types.version !== undefined) source.packageVersion = types.version;
  source.typesEntry = types.entryRel;
  const packageRoot = path.join(root, "node_modules", ...pkg.split("/"));
  const { components: found, warnings } = await componentsFromDts(types.entry, { packageRoot });
  const components: CatalogComponent[] = found.map((c) => {
    const props = (c.props?.props ?? []).map(toCatalogProp);
    const comp: CatalogComponent = {
      name: c.name,
      module: pkg,
      origin: "ds-npm",
      file: path.relative(root, c.file).split(path.sep).join("/"),
      props,
      propsStatus: props.length > 0 ? "ok" : "none",
    };
    if (c.props && c.props.inherits.length > 0) comp.inherits = c.props.inherits;
    // MUI는 컴포넌트 JSDoc이 "Demos:" 링크 목록으로 시작한다 — 콜론으로 끝나는 첫 문단은 설명이 아니다
    if (c.doc?.description !== undefined && !c.doc.description.endsWith(":")) comp.description = c.doc.description;
    if (c.doc?.deprecated !== undefined) comp.deprecated = c.doc.deprecated;
    return comp;
  });
  return { components, source, warnings };
}
