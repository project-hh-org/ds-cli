import path from "node:path";
import { DEFAULT_GUARD_POLICY, evaluateFile, extractFileStyles, extractorMatchers, isRatedUsage, type ExtractorMatcher } from "@dsmith-dev/core";
import type { Extractor, StyleProperty, StyleUsage } from "@dsmith-dev/extractor-api";
import type { Workspace } from "../workspace.js";
import { resolveNormalized } from "./resolve-token.js";

export interface LintSnippetInput {
  code: string;
  filename?: string | undefined;
  /** violations 페이지 커서. 페이지 나누기는 server.ts가 한다. */
  cursor?: string | undefined;
}

export interface Violation {
  line: number;
  column: number;
  property: StyleProperty;
  raw: string;
  /** `suggestionFor`로 페이지에 실리는 위반에만 붙인다. distance 단위는 resolve_token과 같다 */
  suggestion?: { name: string; value: string; distance: number; confidence: "high" | "medium" | "low" };
  extractor: string;
}

export interface LintSnippetOutput {
  /** 제안(suggestion)은 비어 있다 — 비용이 들어 페이지에 실릴 위반에만 `suggestionFor`로 붙인다 */
  violations: Violation[];
  /** 평가 대상(isRatedUsage) usage의 출처별 개수. tailwind-default는 어느 칸에도 세지 않는다 */
  summary: { hardcoded: number; token: number; dynamic: number };
  extractorsRun: string[];
  /** 검사가 조용히 끝난 이유가 파일 종류 추정 실패로 보일 때의 안내 */
  hint?: string;
}

const DEFAULT_FILE = "snippet.tsx";
export const SUPPORTED_FILES = ".tsx/.jsx/.ts/.js/.css/.scss";
export const FILENAME_HINT = "filename을 지정하세요 (예: styles.css, Button.tsx)";

/** JSX 태그나 JS/TS 선언·모듈 문장이 보이는가(스타일 없는 코드가 조용한 것은 정상이다) */
function looksLikeScript(code: string): boolean {
  return /<[A-Za-z>]/.test(code) || /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface)\s/.test(code);
}

/** CSS 같은가: `.`·`#`·`:root`·`@`로 시작하거나, JSX 없이 `{`·`:`·`;`가 모두 있다 */
function looksLikeCss(code: string): boolean {
  const text = code.trim();
  if (/^[.#@]/.test(text) || text.startsWith(":root")) return true;
  return text.includes("{") && text.includes(":") && text.includes(";") && !/<[A-Za-z>]/.test(text);
}

/** 위반 → 정규화한 값. 응답에는 싣지 않는다 */
const normalizedOf = new WeakMap<Violation, StyleUsage["normalized"]>();

/** Extractor 목록마다 glob 매처를 한 번만 컴파일한다(점 디렉터리도 맞춘다). */
const matcherCache = new WeakMap<Extractor[], ExtractorMatcher[]>();
function matchersOf(extractors: Extractor[]): ExtractorMatcher[] {
  let m = matcherCache.get(extractors);
  if (m === undefined) {
    m = extractorMatchers(extractors, { dot: true });
    matcherCache.set(extractors, m);
  }
  return m;
}

/** 가상 파일 이름을 인덱서가 쓰는 root 상대 POSIX 경로 모양으로 맞춘다: 역슬래시·`.`·`..`·빈 조각을 없앤다. */
function virtualFile(root: string, filename: string | undefined): string {
  if (filename === undefined || filename === "") return DEFAULT_FILE;
  let file = filename.split("\\").join("/");
  if (path.posix.isAbsolute(file) || path.isAbsolute(file)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    file = rel.startsWith("..") ? (file.split("/").pop() ?? file) : rel;
  }
  const segments = file.split("/").filter((s) => s !== "" && s !== "." && s !== "..");
  return segments.length === 0 ? DEFAULT_FILE : segments.join("/");
}

/** 코드 조각을 레포 인덱서와 같은 Extractor 규칙으로 읽어 하드코딩 값을 위반으로 보고한다. 디스크에는 쓰지 않는다. */
export function lintSnippet(ws: Workspace, extractors: Extractor[], input: LintSnippetInput): LintSnippetOutput {
  const file = virtualFile(ws.root, input.filename);
  const matchers = matchersOf(extractors);
  if (!matchers.some((m) => m.matches(file))) {
    throw new Error(`검사할 Extractor 없음: ${file} (지원: ${SUPPORTED_FILES})`);
  }
  const { styles, extractorsRun } = extractFileStyles({ root: ws.root, file, code: input.code }, matchers);

  const summary = { hardcoded: 0, token: 0, dynamic: 0 };
  const violations: Violation[] = [];
  for (const u of styles.filter(isRatedUsage)) {
    if (u.source === "token") summary.token += 1;
    else if (u.source === "dynamic") summary.dynamic += 1;
  }
  // 위반은 core 규칙 엔진이 낸다(ESLint 플러그인·guard --ci와 같은 함수). 토큰 제안은 suggestionFor가 따로 붙인다.
  const findings = evaluateFile({
    file,
    usages: styles,
    components: [],
    tokens: [],
    ds: { modules: [], components: [] },
    preferred: [],
    policy: DEFAULT_GUARD_POLICY,
  });
  // hardcoded 개수는 규칙 엔진의 finding 수에서 낸다 — 위반 목록과 같은 출처라 어긋날 수 없다(DEFAULT 정책은 아무것도 허용하지 않는다).
  summary.hardcoded = findings.filter((f) => f.rule === "no-hardcoded-style").length;
  for (const f of findings) {
    const u = f.usageIndex === undefined ? undefined : styles[f.usageIndex];
    if (f.rule !== "no-hardcoded-style" || u === undefined) continue;
    const v: Violation = { line: u.line, column: u.column, property: u.property, raw: u.raw, extractor: u.extractor };
    normalizedOf.set(v, u.normalized);
    violations.push(v);
  }
  violations.sort((a, b) => a.line - b.line || a.column - b.column);
  // filename 없이 기본 파일(tsx)로 읽었는데 아무 Extractor도 돌지 않았거나(스크립트처럼 보이지 않는 코드), CSS 같은 코드에서 아무것도 못 읽었으면 filename 누락이 원인이다.
  const guessed = input.filename === undefined || input.filename === "";
  const silent = styles.length === 0 && (extractorsRun.length === 0 ? !looksLikeScript(input.code) : looksLikeCss(input.code));
  const hint = guessed && input.code.trim() !== "" && silent ? { hint: FILENAME_HINT } : {};
  return { violations, summary, extractorsRun, ...hint };
}

/** 위반에 가장 가까운 토큰 제안을 붙인 복사본. lintSnippet이 만든 위반에만 쓴다. */
export function suggestionFor(ws: Workspace, v: Violation): Violation {
  const normalized = normalizedOf.get(v);
  if (normalized === undefined) return v;
  const r = resolveNormalized(ws, normalized, { raw: v.raw, property: v.property });
  return r.token === undefined || r.distance === null ? v : { ...v, suggestion: { ...r.token, distance: r.distance, confidence: r.confidence } };
}
