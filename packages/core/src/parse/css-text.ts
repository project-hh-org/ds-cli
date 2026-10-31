/** 템플릿 리터럴 `${}` 자리를 대신하는 표식. 숫자는 표현식 인덱스. */
export const PLACEHOLDER = /\u0000(\d+)\u0000/;

export interface CssDecl {
  property: string;
  /** 앞뒤 공백을 뺀 값 텍스트 */
  value: string;
  /** 값 구간 시작(포함). `offset`이 더해진 텍스트 기준 위치 */
  start: number;
  /** 값 구간 끝(제외) */
  end: number;
  /** 값에 PLACEHOLDER가 있음 */
  dynamic: boolean;
}

/** `/* *\/` 주석을 같은 길이의 공백으로 바꾼다(줄바꿈은 유지). 문자열 안의 `/*`는 건드리지 않는다. */
function blankComments(text: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) out += text[++i]!;
      else if (ch === quote || ch === "\n") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 ? text.length : close + 2;
      out += text.slice(i, end).replace(/[^\n]/g, " ");
      i = end - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

const DECLARATION = /^(\s*)([A-Za-z_$-][\w$-]*)\s*:/;

/** `text[from, to)` 구간이 선언이면 CssDecl로. 아니면 null. */
function declarationOf(text: string, from: number, to: number, offset: number): CssDecl | null {
  const segment = text.slice(from, to);
  const head = DECLARATION.exec(segment);
  if (head === null) return null;
  const valueFrom = head[0].length;
  const raw = segment.slice(valueFrom);
  const lead = raw.length - raw.trimStart().length;
  const value = raw.trim();
  if (value === "") return null;
  const start = from + valueFrom + lead;
  return {
    property: head[2]!,
    value,
    start: start + offset,
    end: start + value.length + offset,
    dynamic: PLACEHOLDER.test(value),
  };
}

/**
 * CSS 텍스트에서 선언(`속성: 값`)을 모두 찾는다. 규칙 블록·중첩 블록·`@media` 안은 깊이와 상관없이 같은 텍스트로 본다.
 * `{` 앞의 문장(선택자·at-rule 머리)과 `@import ...;` 같은 문장은 선언이 아니다.
 * 세미콜론·중괄호는 따옴표·괄호·scss 보간(`#{}`) 안에서는 끝 표지로 보지 않는다.
 * `offset`은 반환하는 start/end에 더해진다(더 큰 파일 안에서 잘라 온 텍스트일 때).
 */
export function parseCssDeclarations(text: string, offset = 0): CssDecl[] {
  const src = blankComments(text);
  const decls: CssDecl[] = [];

  let segStart = 0;
  let parens = 0;
  let quote: string | null = null;

  const flush = (end: number): void => {
    const decl = declarationOf(src, segStart, end, offset);
    if (decl !== null) decls.push(decl);
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote || ch === "\n") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && src[i + 1] === "{") {
      const close = src.indexOf("}", i + 2);
      i = close === -1 ? src.length : close;
    } else if (ch === "(") {
      parens++;
    } else if (ch === ")") {
      if (parens > 0) parens--;
    } else if (parens === 0) {
      if (ch === "{") {
        segStart = i + 1; // 선택자·at-rule 머리는 버린다
      } else if (ch === ";" || ch === "}") {
        flush(i);
        segStart = i + 1;
      }
    }
  }
  flush(src.length);
  return decls;
}
