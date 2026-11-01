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

export interface Analysis {
  root: string;
  /** root 상대 POSIX */
  file: string;
  usages: StyleUsage[];
  /** evaluateFile 결과 그대로(토큰 치환 대상이 아닌 것 포함 — 거르는 일은 규칙이 한다) */
  findings: Finding[];
  snapshot: GuardSnapshot;
  /** 스냅샷을 만든 뒤 내용이 바뀌었거나 없어진 토큰 파일(root 상대). 비어 있으면 최신 */
  stale: string[];
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
  let usages: StyleUsage[];
  try {
    usages = extractFileStyles({ root, file, code }, entry.matchers).styles;
  } catch {
    return null;
  }
  let components: ComponentUsage[] = [];
  if (SCRIPT_FILE.test(file)) {
    try {
      components = extractComponentUsage(file, parseTsx(code, file), snapshot.moduleContext.tsPaths, moduleContextOf(snapshot));
    } catch {
      components = [];
    }
  }
  const findings = evaluateFile({ file, usages, components, ...ruleContextOf(snapshot) });
  return { root, file, usages, findings, snapshot, stale: staleFiles(entry) };
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

/** 낡은 스냅샷이면 메시지 앞에 붙이는 안내 */
export function withStaleNotice(a: Analysis, message: string): string {
  return a.stale.length === 0 ? message : `[guard.json이 낡음: ${a.stale.join(", ")} 변경됨 — dsmith guard init 다시 실행] ${message}`;
}
