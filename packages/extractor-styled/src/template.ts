import { classifyDeclaration, lineLocator, parseCssDeclarations, usagesFromStyleObject } from "@dsmith/core";
import type { CssDecl } from "@dsmith/core";
import type { ExtractContext, StyleUsage } from "@dsmith/extractor-api";
import type { ObjectExpression, TemplateLiteral } from "@babel/types";
import { registerPatchTarget } from "./write.js";

export interface TemplateDecl extends CssDecl {
  /** 값의 소스 코드 오프셋(포함). dynamic이면 `${…}`를 포함한 값 구간 전체 */
  codeStart: number;
  /** 값의 소스 코드 오프셋(제외) */
  codeEnd: number;
}

/** 이어 붙인 CSS 텍스트의 한 조각과 그 조각이 온 소스 구간. quasi는 1:1, `${}`는 PLACEHOLDER 한 덩어리. */
interface Segment {
  textStart: number;
  textEnd: number;
  codeStart: number;
  codeEnd: number;
  quasi: boolean;
}

/*
 * 조각 표는 textStart 오름차순으로 빈틈없이 이어진다(빈 quasi는 길이 0). 선언마다 이진 탐색으로 조각을 찾는다.
 */

/** 시작 오프셋(포함)을 소스로. PLACEHOLDER 안이면 `${`의 위치. */
function startToCode(segments: Segment[], t: number): number {
  // textStart <= t 인 마지막 조각. 빈 조각과 시작이 겹치면 뒤의(비어 있지 않은) 조각이 잡힌다.
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.textStart <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const s = found === -1 ? undefined : segments[found]!;
  if (s === undefined || t >= s.textEnd) return segments.at(-1)!.codeEnd;
  return s.quasi ? s.codeStart + (t - s.textStart) : s.codeStart;
}

/** 끝 오프셋(제외)을 소스로. PLACEHOLDER 안이면 `}` 다음 위치. */
function endToCode(segments: Segment[], t: number): number {
  // textEnd >= t 인 첫 조각. 빈 조각과 끝이 겹치면 앞의(비어 있지 않은) 조각이 잡힌다.
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.textEnd >= t) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  const s = found === -1 ? undefined : segments[found]!;
  if (s === undefined || s.textStart >= t) return segments[0]!.codeStart;
  return s.quasi ? s.codeStart + (t - s.textStart) : s.codeEnd;
}

/**
 * 템플릿 리터럴의 CSS 선언을 찾는다. quasi의 소스 텍스트(raw)를 이어 붙이고 각 `${}` 자리에 `\0<index>\0`를 넣어
 * `parseCssDeclarations`(줄 주석 허용)로 읽은 뒤, 값 구간을 원본 코드 오프셋(`codeStart/codeEnd`)으로 되돌린다.
 * raw를 쓰므로 이스케이프가 있어도 텍스트와 소스가 1:1로 대응한다.
 */
export function declarationsFromTemplate(tpl: TemplateLiteral, code: string): TemplateDecl[] {
  const segments: Segment[] = [];
  let text = "";
  for (const [i, quasi] of tpl.quasis.entries()) {
    if (quasi.start == null || quasi.end == null) return [];
    const piece = code.slice(quasi.start, quasi.end);
    segments.push({ textStart: text.length, textEnd: text.length + piece.length, codeStart: quasi.start, codeEnd: quasi.end, quasi: true });
    text += piece;

    const next = tpl.quasis[i + 1];
    if (next === undefined) break;
    if (next.start == null) return [];
    const mark = `\u0000${i}\u0000`;
    segments.push({ textStart: text.length, textEnd: text.length + mark.length, codeStart: quasi.end, codeEnd: next.start, quasi: false });
    text += mark;
  }

  return parseCssDeclarations(text, 0, { lineComments: true }).map((decl) => ({
    ...decl,
    codeStart: startToCode(segments, decl.start),
    codeEnd: endToCode(segments, decl.end),
  }));
}

/** 같은 파일의 템플릿이 여럿이어도 줄 시작 표를 한 번만 만든다. */
let cachedLocator: { code: string; lineOf: (offset: number) => { line: number; column: number } } | null = null;

function locatorFor(code: string): (offset: number) => { line: number; column: number } {
  if (cachedLocator?.code !== code) cachedLocator = { code, lineOf: lineLocator(code) };
  return cachedLocator.lineOf;
}

/** 템플릿 선언을 StyleUsage로(분류 규칙은 extractor-css와 같은 `classifyDeclaration`). 하드코딩 값은 치환 구간을 기록한다. */
export function usagesFromDecls(decls: TemplateDecl[], ctx: ExtractContext, extractorName: string): StyleUsage[] {
  const lineOf = locatorFor(ctx.code);
  const usages: StyleUsage[] = [];
  for (const decl of decls) {
    const result = classifyDeclaration(
      { ...decl, start: decl.codeStart, end: decl.codeEnd },
      { file: ctx.file, extractor: extractorName, code: ctx.code, lineOf },
    );
    if (result === null) continue;
    if (result.patch !== null) registerPatchTarget(result.usage, { ...result.patch, file: ctx.file, quote: false });
    usages.push(result.usage);
  }
  return usages;
}

export function usagesFromTemplate(tpl: TemplateLiteral, ctx: ExtractContext, extractorName: string): StyleUsage[] {
  return usagesFromDecls(declarationsFromTemplate(tpl, ctx.code), ctx, extractorName);
}

/**
 * 객체 문법 스타일(`styled.div({...})`, `css={{...}}`) → StyleUsage. 규칙은 inline-style과 같다
 * (문자열 값은 따옴표 안 하위 구간을 그대로, 숫자 값은 노드를 문자열 리터럴로 치환).
 * 중첩 선택자·미디어 쿼리 객체(`"&:hover": {…}`, `[bp]: {…}`)는 재귀한다.
 */
export function usagesFromObject(obj: ObjectExpression, ctx: ExtractContext, extractorName: string): StyleUsage[] {
  const usages: StyleUsage[] = [];
  const objectCtx = { file: ctx.file, code: ctx.code, extractor: extractorName, nested: true };
  for (const { usage, patch } of usagesFromStyleObject(obj, objectCtx)) {
    if (patch !== null) registerPatchTarget(usage, { ...patch, file: ctx.file });
    usages.push(usage);
  }
  return usages;
}
