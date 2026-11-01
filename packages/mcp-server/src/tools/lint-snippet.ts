import path from "node:path";
import { isRatedUsage, type Extractor, type StyleProperty, type StyleUsage } from "@dsmith-dev/core";
import picomatch from "picomatch";
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
  suggestion?: { name: string; value: string; confidence: "high" | "medium" | "low" };
  extractor: string;
}

export interface LintSnippetOutput {
  violations: Violation[];
  /** 평가 대상(isRatedUsage) usage의 출처별 개수. tailwind-default는 어느 칸에도 세지 않는다 */
  summary: { hardcoded: number; token: number; dynamic: number };
  extractorsRun: string[];
}

const DEFAULT_FILE = "snippet.tsx";

/** 가상 파일 이름을 인덱서가 쓰는 root 상대 POSIX 경로 모양으로 맞춘다. */
function virtualFile(root: string, filename: string | undefined): string {
  if (filename === undefined || filename === "") return DEFAULT_FILE;
  let file = filename.split("\\").join("/");
  if (path.isAbsolute(file)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    file = rel.startsWith("..") ? path.basename(file) : rel;
  }
  return file.replace(/^\.\//, "");
}

/** 코드 조각을 레포 인덱서와 같은 Extractor 규칙으로 읽어 하드코딩 값을 위반으로 보고한다. 디스크에는 쓰지 않는다. */
export function lintSnippet(ws: Workspace, extractors: Extractor[], input: LintSnippetInput): LintSnippetOutput {
  const ctx = { root: ws.root, file: virtualFile(ws.root, input.filename), code: input.code };
  const usages: StyleUsage[] = [];
  const extractorsRun: string[] = [];
  for (const extractor of extractors) {
    if (!picomatch(extractor.files, { dot: false })(ctx.file)) continue;
    try {
      if (!extractor.appliesTo(ctx)) continue;
      extractorsRun.push(extractor.name);
      usages.push(...extractor.extract(ctx));
    } catch (err) {
      throw new Error(`parse(${extractor.name}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summary = { hardcoded: 0, token: 0, dynamic: 0 };
  const violations: Violation[] = [];
  for (const u of usages.filter(isRatedUsage)) {
    if (u.source === "token") summary.token += 1;
    else if (u.source === "dynamic") summary.dynamic += 1;
    else if (u.source === "hardcoded") {
      summary.hardcoded += 1;
      violations.push(violationOf(ws, u));
    }
  }
  violations.sort((a, b) => a.line - b.line || a.column - b.column);
  return { violations, summary, extractorsRun };
}

function violationOf(ws: Workspace, u: StyleUsage): Violation {
  const v: Violation = { line: u.line, column: u.column, property: u.property, raw: u.raw, extractor: u.extractor };
  const r = resolveNormalized(ws, u.normalized, { raw: u.raw, property: u.property });
  if (r.token !== undefined) v.suggestion = { ...r.token, confidence: r.confidence };
  return v;
}
