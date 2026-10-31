export interface ParsedClass {
  /** variant 접두를 포함한 원본 토큰 */
  raw: string;
  variants: string[];
  utility: string;
  value: string | null;
  arbitrary: boolean;
  negative: boolean;
}

/** `utility-value` 분리에 쓰는 유틸리티 접두 목록. `gap-x`처럼 하이픈이 든 이름이 있어 가장 긴 접두를 우선한다. */
export const KNOWN_UTILITIES: readonly string[] = [
  "p", "px", "py", "pt", "pr", "pb", "pl",
  "m", "mx", "my", "mt", "mr", "mb", "ml",
  "gap", "gap-x", "gap-y",
  "w", "min-w", "max-w",
  "h", "min-h", "max-h",
  "rounded", "rounded-s", "rounded-e", "rounded-t", "rounded-r", "rounded-b", "rounded-l",
  "rounded-ss", "rounded-se", "rounded-ee", "rounded-es",
  "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl",
  "text", "bg",
  "border", "border-x", "border-y", "border-s", "border-e",
  "border-t", "border-r", "border-b", "border-l",
  "fill", "stroke", "ring", "outline",
];

const BY_LENGTH_DESC = [...KNOWN_UTILITIES].sort((a, b) => b.length - a.length);

/** 대괄호 바깥의 구분자 위치들. `[&:hover]:p-4`처럼 arbitrary 안의 `:`는 구분자가 아니다. */
function splitOutsideBrackets(token: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === separator && depth === 0) {
      parts.push(token.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(token.slice(from));
  return parts;
}

/** 클래스 토큰 하나(공백 없음)를 분해한다. */
export function parseClassToken(raw: string): ParsedClass {
  const segments = splitOutsideBrackets(raw, ":");
  const variants = segments.slice(0, -1);
  let body = segments[segments.length - 1] ?? "";

  const negative = body.startsWith("-");
  if (negative) body = body.slice(1);

  const arbitraryAt = body.endsWith("]") ? body.indexOf("-[") : -1;
  if (arbitraryAt > 0) {
    return {
      raw,
      variants,
      utility: body.slice(0, arbitraryAt),
      value: body.slice(arbitraryAt + 2, -1).replaceAll("_", " "),
      arbitrary: true,
      negative,
    };
  }

  // `border-t`, `gap-x`처럼 토큰 전체가 유틸리티 이름이면 value 없는 유틸리티다.
  if (KNOWN_UTILITIES.includes(body)) {
    return { raw, variants, utility: body, value: null, arbitrary: false, negative };
  }

  const prefix = BY_LENGTH_DESC.find((name) => body.startsWith(`${name}-`));
  if (prefix === undefined) {
    return { raw, variants, utility: body, value: null, arbitrary: false, negative };
  }
  const value = body.slice(prefix.length + 1);
  return {
    raw,
    variants,
    utility: prefix,
    value: value === "" ? null : value,
    arbitrary: false,
    negative,
  };
}

/** 공백(개행·탭 포함)으로 나뉜 클래스 문자열을 토큰별로 분해한다. */
export function parseClassString(s: string): ParsedClass[] {
  return s
    .split(/\s+/)
    .filter((token) => token !== "")
    .map(parseClassToken);
}
