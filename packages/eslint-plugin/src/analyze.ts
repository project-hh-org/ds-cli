// 동기 전용 모듈 — ESLint 규칙이 쓴다. 비동기 구문 금지(테스트로 고정).
// ESLint 9/10 규칙 API 근거: dsmith 계획 부록 C.1 (2026-11-01, eslint 9.39.5·10.14.0 로컬 프로브) —
// context.sourceCode · context.filename · context.settings · context.cwd만 쓴다.
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import picomatch from "picomatch";
import type { Rule, SourceCode } from "eslint";
import {
  evaluateFile,
  extractComponentUsage,
  extractFileStyles,
  extractorMatchers,
  findGuardSnapshotSync,
  moduleContextOf,
  parseTsx,
  readGuardSnapshotSync,
  ruleContextOf,
  type ComponentUsage,
  type ExtractorMatcher,
  type Finding,
  type GuardSnapshot,
} from "@dsmith-dev/core";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { BUILTIN_EXTRACTORS } from "./registry.js";

/**
 * 파일 하나의 분석. 스냅샷·경로 판정은 즉시, 추출은 처음 읽을 때 한 번만 한다 —
 * 스타일 규칙이 꺼져 있으면 스타일 추출기가, 컴포넌트 규칙이 꺼져 있으면 JSX 파싱이 돌지 않는다.
 */
export interface Analysis {
  root: string;
  /** root 상대 POSIX */
  file: string;
  snapshot: GuardSnapshot;
  /** 스냅샷을 만든 뒤 내용이 바뀌었거나 없어진 토큰 파일(root 상대). 비어 있으면 최신 */
  stale: string[];
  /** 스타일 추출 결과(지연). styleFindings의 usageIndex가 가리킨다 */
  readonly usages: StyleUsage[];
  /** evaluateFile의 스타일 finding 그대로(토큰 치환 대상이 아닌 것 포함 — 거르는 일은 규칙이 한다). 지연 */
  readonly styleFindings: Finding[];
  /** evaluateFile의 컴포넌트 finding(prefer-ds-component·no-deprecated-component). 지연 */
  readonly componentFindings: Finding[];
  /** 스타일 + 컴포넌트 finding 전체(정렬은 evaluateFile 규칙). 둘 다 추출한다 */
  readonly findings: Finding[];
  /** 낡은 스냅샷 안내를 이 파일에서 이미 한 번 냈는지 */
  staleNoticed: boolean;
}

interface Loaded {
  mtimeMs: number;
  snapshot: GuardSnapshot | null;
  root: string;
  excluded: (file: string) => boolean;
  allowed: (file: string) => boolean;
  matchers: ExtractorMatcher[];
  /** 토큰 파일 stat 서명 → stale 목록 */
  staleSig: string | null;
  stale: string[];
}

const snapshotCache = new Map<string, Loaded>();
const analyses = new WeakMap<SourceCode, Analysis | null>();
const warned = new Set<string>();

const SCRIPT_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  process.emitWarning(message, { code: "DSMITH_GUARD_SNAPSHOT" });
}

function globMatcher(globs: readonly string[]): (file: string) => boolean {
  if (globs.length === 0) return () => false;
  return picomatch([...globs], { dot: true });
}

function load(guardFile: string): Loaded | null {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(guardFile).mtimeMs;
  } catch {
    snapshotCache.delete(guardFile);
    return null;
  }
  const cached = snapshotCache.get(guardFile);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached;
  const root = path.resolve(path.dirname(guardFile), "..");
  let entry: Loaded;
  try {
    const snapshot = readGuardSnapshotSync(guardFile);
    const extractors = snapshot.extractors.flatMap((name) => {
      const e = Object.hasOwn(BUILTIN_EXTRACTORS, name) ? BUILTIN_EXTRACTORS[name] : undefined;
      return e === undefined ? [] : [e];
    });
    entry = {
      mtimeMs,
      snapshot,
      root,
      excluded: globMatcher(snapshot.exclude),
      allowed: globMatcher(snapshot.policy.allow.files),
      matchers: extractorMatchers(extractors, { dot: true }),
      staleSig: null,
      stale: [],
    };
  } catch (err) {
    warnOnce(`${guardFile}@${mtimeMs}`, (err as Error).message);
    entry = { mtimeMs, snapshot: null, root, excluded: () => false, allowed: () => false, matchers: [], staleSig: null, stale: [] };
  }
  snapshotCache.set(guardFile, entry);
  return entry;
}

/** 토큰 파일의 mtime·크기가 그대로면 이전 판정을 재사용하고, 바뀌었을 때만 sha256을 다시 비교한다. */
function staleFiles(entry: Loaded): string[] {
  const snapshot = entry.snapshot;
  if (snapshot === null) return [];
  const sig = snapshot.tokenFiles
    .map((t) => {
      try {
        const st = fs.statSync(path.resolve(entry.root, t.file));
        return `${t.file}:${st.mtimeMs}:${st.size}`;
      } catch {
        return `${t.file}:gone`;
      }
    })
    .join("|");
  if (entry.staleSig === sig) return entry.stale;
  entry.stale = snapshot.tokenFiles
    .filter((t) => {
      try {
        return createHash("sha256").update(fs.readFileSync(path.resolve(entry.root, t.file))).digest("hex") !== t.sha256;
      } catch {
        return true;
      }
    })
    .map((t) => t.file);
  entry.staleSig = sig;
  return entry.stale;
}

function guardFileOf(context: Rule.RuleContext, filename: string): string | null {
  const settings = context.settings as { dsmith?: { guardFile?: unknown } } | undefined;
  const configured = settings?.dsmith?.guardFile;
  if (typeof configured === "string" && configured !== "") return path.resolve(context.cwd, configured);
  return findGuardSnapshotSync(path.dirname(filename))?.file ?? null;
}

function compute(context: Rule.RuleContext): Analysis | null {
  const rawName = context.filename;
  if (rawName === "" || rawName.startsWith("<")) return null;
  const filename = path.resolve(context.cwd, rawName);
  const guardFile = guardFileOf(context, filename);
  if (guardFile === null) return null;
  const entry = load(guardFile);
  if (entry === null || entry.snapshot === null) return null;
  const { snapshot, root } = entry;

  const rel = path.relative(root, filename);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const file = rel.split(path.sep).join("/");
  if (entry.excluded(file) || entry.allowed(file)) return null;

  const code = context.sourceCode.text;
  const lazy = <T>(make: () => T): (() => T) => {
    let value: { v: T } | undefined;
    return () => (value ??= { v: make() }).v;
  };
  const usages = lazy((): StyleUsage[] => {
    try {
      return extractFileStyles({ root, file, code }, entry.matchers).styles;
    } catch {
      return [];
    }
  });
  const components = lazy((): ComponentUsage[] => {
    if (!SCRIPT_FILE.test(file)) return [];
    try {
      return extractComponentUsage(file, parseTsx(code, file), snapshot.moduleContext.tsPaths, moduleContextOf(snapshot));
    } catch {
      return [];
    }
  });
  const rules = ruleContextOf(snapshot);
  // 스타일 finding은 usages만, 컴포넌트 finding은 components만 본다 — 한쪽만 필요하면 다른 쪽을 추출하지 않는다.
  const styleFindings = lazy(() => evaluateFile({ file, usages: usages(), components: [], ...rules }));
  const componentFindings = lazy(() => evaluateFile({ file, usages: [], components: components(), ...rules }));
  return {
    root,
    file,
    snapshot,
    stale: staleFiles(entry),
    staleNoticed: false,
    get usages() {
      return usages();
    },
    get styleFindings() {
      return styleFindings();
    },
    get componentFindings() {
      return componentFindings();
    },
    get findings() {
      return evaluateFile({ file, usages: usages(), components: components(), ...rules });
    },
  };
}

/**
 * 같은 SourceCode에 대해 한 번만 계산한다(규칙 3개가 공유).
 * 스냅샷이 없으면 null(조용히 무보고), 깨졌으면 null + process 경고 1회.
 */
export function analyze(context: Rule.RuleContext): Analysis | null {
  const sourceCode = context.sourceCode;
  if (analyses.has(sourceCode)) return analyses.get(sourceCode) ?? null;
  const result = compute(context);
  analyses.set(sourceCode, result);
  return result;
}

/** 낡은 스냅샷이면 파일의 첫 보고 메시지에만 안내를 붙인다(나머지는 원문 그대로). */
export function withStaleNotice(a: Analysis, message: string): string {
  if (a.stale.length === 0 || a.staleNoticed) return message;
  a.staleNoticed = true;
  return `[guard.json 낡음: ${a.stale.join(", ")} 변경됨 — dsmith guard init 다시 실행] ${message}`;
}
