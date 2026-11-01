import fs from "node:fs/promises";
import path from "node:path";

/** import 경로에서 뗄 소스 확장자. */
export const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;

/** `./`, `../`, `@/`, `~/`, 선행 `/`, 선행 `src/`를 벗겨 별칭·상대경로 차이를 무시한다. */
export function normalizeSpecifier(spec: string): string {
  return spec.replace(/^(?:\.{1,2}\/)+/, "").replace(/^[@~]?\//, "").replace(/^src\//, "");
}

/** 경로 형태(상대, 루트 절대, `@/`·`~/` 별칭)의 specifier인지. */
const PATH_LIKE = /^(?:\.|\/|[@~]\/)/;

/**
 * 패키지 specifier에서 서브패스를 뗀 패키지명. scoped는 앞 두 세그먼트, bare는 첫 세그먼트.
 * 경로 형태(`.`, `/`, `@/`, `~/`로 시작)는 그대로 둔다.
 */
export function normalizePackageSpecifier(spec: string): string {
  if (PATH_LIKE.test(spec)) return spec;
  const parts = spec.split("/");
  if (spec.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  return parts[0] ?? spec;
}

/** 해석한 경로에서 확장자와 끝의 `/index`를 뗀다. 상대 import와 paths 해석이 같은 모양이 되게 한다. */
export function stripModulePath(p: string): string {
  return p.replace(SOURCE_EXTENSION, "").replace(/\/index$/, "");
}

export interface TsPaths {
  /** root 상대 POSIX 경로. ""이면 root. */
  baseUrl: string;
  paths: Record<string, string[]>;
}

/** 문자열 리터럴을 건너뛰며 `//`·`/* *\/` 주석을 지운다. */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** 문자열 리터럴을 건너뛰며 `}`·`]` 바로 앞(공백만 사이에 둔)의 쉼표를 지운다. */
function stripTrailingCommas(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? "")) j += 1;
      if (text[j] === "}" || text[j] === "]") {
        i += 1;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

/** JSONC(주석·끝 쉼표 허용) 문자열을 파싱한다. */
function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripComments(text.replace(/^﻿/, ""))));
}

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 설정 파일을 읽어 객체로 돌려준다. 없거나, 디렉터리이거나, 깨졌거나, 최상위가 객체가 아니면 null. */
async function readConfig(file: string): Promise<JsonObject | null> {
  try {
    const value = parseJsonc(await fs.readFile(file, "utf-8"));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** `extends` 값을 확장하는 파일 기준으로 찾아 읽는다(상대·절대 경로 또는 그 디렉터리의 node_modules). */
async function readExtended(spec: string, fromDir: string): Promise<{ file: string; config: JsonObject } | null> {
  const base =
    spec.startsWith(".") || path.isAbsolute(spec) ? path.resolve(fromDir, spec) : path.join(fromDir, "node_modules", spec);
  const candidates = [base];
  if (!base.endsWith(".json")) candidates.push(`${base}.json`);
  candidates.push(path.join(base, "tsconfig.json"));
  for (const file of candidates) {
    const config = await readConfig(file);
    if (config !== null) return { file, config };
  }
  return null;
}

interface Declared<T> {
  value: T;
  /** 선언한 설정 파일의 디렉터리(절대 경로) */
  dir: string;
}

interface Collected {
  baseUrl?: Declared<string>;
  paths?: Declared<Record<string, string[]>>;
}

/** 한 설정 파일의 compilerOptions.baseUrl·paths를 앞서 모은 값 위에 덮어쓴다(paths는 통째로 대체). */
function collect(into: Collected, config: JsonObject, dir: string): void {
  const options = config.compilerOptions;
  if (!isObject(options)) return;
  if (typeof options.baseUrl === "string") into.baseUrl = { value: options.baseUrl, dir };
  if (isObject(options.paths)) {
    const paths: Record<string, string[]> = {};
    for (const [key, targets] of Object.entries(options.paths)) {
      if (!Array.isArray(targets)) continue;
      const strings = targets.filter((t): t is string => typeof t === "string");
      if (strings.length > 0) paths[key] = strings;
    }
    into.paths = { value: paths, dir };
  }
}

function toRootRelative(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

/**
 * `<root>/tsconfig.json`(없으면 `jsconfig.json`)의 baseUrl·paths를 읽는다.
 * JSONC를 허용하고 `extends`는 한 단계만 따라간다(읽지 못하면 무시). 자식의 값이 부모를 덮는다.
 * baseUrl이 없으면 paths를 선언한 파일의 디렉터리를 기준으로 한다.
 * paths가 없으면 null. 어떤 입력에도 예외를 던지지 않는다.
 */
export async function readTsconfigPaths(root: string): Promise<TsPaths | null> {
  try {
    let file = path.join(root, "tsconfig.json");
    let config = await readConfig(file);
    if (config === null) {
      try {
        await fs.access(file);
        return null; // tsconfig.json은 있지만 깨졌다
      } catch {
        file = path.join(root, "jsconfig.json");
        config = await readConfig(file);
      }
    }
    if (config === null) return null;

    const dir = path.dirname(file);
    const collected: Collected = {};
    const ext = config.extends;
    const parents = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext.filter((e) => typeof e === "string") : [];
    for (const spec of parents) {
      const parent = await readExtended(spec, dir);
      if (parent !== null) collect(collected, parent.config, path.dirname(parent.file));
    }
    collect(collected, config, dir);

    const paths = collected.paths;
    if (paths === undefined || Object.keys(paths.value).length === 0) return null;
    const baseAbs =
      collected.baseUrl !== undefined ? path.resolve(collected.baseUrl.dir, collected.baseUrl.value) : paths.dir;
    return { baseUrl: toRootRelative(root, baseAbs), paths: paths.value };
  } catch {
    return null;
  }
}

/**
 * tsconfig paths로 specifier를 root 상대 POSIX 경로(확장자·끝 `/index` 제거)로 푼다.
 * 정확 일치 키가 와일드카드 키보다 먼저이고, 와일드카드는 접두사가 긴 것부터 본다. 대상 배열의 첫 항목만 쓴다.
 * 모든 import를 삼키는 `"*"` 단독 키는 파일 존재를 확인할 수 없으므로 쓰지 않는다. 일치하지 않으면 null.
 * paths 대상은 baseUrl 기준이라 importer와 무관하다(시그니처는 호출부 일관성을 위해 받는다).
 */
export function resolveWithPaths(spec: string, importer: string, tsPaths: TsPaths | null): string | null {
  void importer;
  if (tsPaths === null) return null;
  let target: string | undefined;
  const exact = Object.hasOwn(tsPaths.paths, spec) && !spec.includes("*") ? tsPaths.paths[spec] : undefined;
  if (exact !== undefined) {
    target = exact[0];
  } else {
    const wildcards = Object.keys(tsPaths.paths)
      .filter((k) => k.includes("*") && k !== "*")
      .map((k) => ({ key: k, prefix: k.slice(0, k.indexOf("*")), suffix: k.slice(k.indexOf("*") + 1) }))
      .sort((a, b) => b.prefix.length - a.prefix.length || a.key.localeCompare(b.key));
    for (const w of wildcards) {
      if (spec.length < w.prefix.length + w.suffix.length) continue;
      if (!spec.startsWith(w.prefix) || !spec.endsWith(w.suffix)) continue;
      const captured = spec.slice(w.prefix.length, spec.length - w.suffix.length);
      target = tsPaths.paths[w.key]?.[0]?.replace("*", captured);
      break;
    }
  }
  if (target === undefined) return null;
  return stripModulePath(path.posix.join(tsPaths.baseUrl === "" ? "." : tsPaths.baseUrl, target));
}
