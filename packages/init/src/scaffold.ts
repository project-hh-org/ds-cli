export interface ScaffoldProp {
  name: string;
  type?: string;
  required?: boolean;
  values?: string[];
}

export interface ScaffoldInput {
  name: string;
  item: string;
  basis: "decided" | "recommended";
  from: string;
  /** 사용처 합집합 + 정의 파일 타입 */
  props: ScaffoldProp[];
  /** ≤3 */
  topUses: { file: string; count: number }[];
  /** 예 "design-system/tokens.css" */
  tokensRef: string;
}

const KEYWORD_TYPES = new Set(["string", "number", "boolean", "null", "undefined", "unknown"]);
const STRING_LITERAL = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** 최상위 `|`로 자른다(따옴표 안의 `|`는 무시). */
function splitUnion(type: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < type.length; i += 1) {
    const ch = type[i] as string;
    if (quote !== null) {
      current += ch;
      if (ch === "\\") {
        current += type[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "|") {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts.filter((p) => p !== "");
}

/**
 * import가 필요 없는 타입인가.
 * 허용: string/number/boolean/null/undefined/unknown 키워드, 문자열·숫자 리터럴과 그 유니온, `() => void`.
 */
export function isSelfContainedType(type: string): boolean {
  const parts = splitUnion(type);
  if (parts.length === 0) return false;
  return parts.every((p) => {
    if (KEYWORD_TYPES.has(p)) return true;
    if (STRING_LITERAL.test(p) || NUMBER_LITERAL.test(p)) return true;
    return /^\(\s*\)\s*=>\s*void$/.test(p);
  });
}

function propLine(p: ScaffoldProp): string {
  const key = IDENTIFIER.test(p.name) ? p.name : JSON.stringify(p.name);
  const optional = p.required === true ? "" : "?";
  if (p.type === undefined) return `  ${key}${optional}: unknown; // TODO: 타입 확인 (사용처에서만 관측)`;
  const oneLine = p.type.replace(/\s+/g, " ").trim();
  if (isSelfContainedType(oneLine)) return `  ${key}${optional}: ${oneLine};`;
  return `  ${key}${optional}: unknown; // 원 타입: ${oneLine}`;
}

/** 컴포넌트 골격 텍스트. 결정적(타임스탬프·절대 경로 없음). */
export function renderScaffold(input: ScaffoldInput): string {
  const origin =
    input.basis === "decided" ? `결정: ${input.from}` : `추천: ${input.from}, 결정 전`;
  const lines = [`// dsmith init 스캐폴드 — ${input.name} (${origin})`];
  if (input.topUses.length > 0) {
    lines.push(
      `// 원 사용처 상위 ${input.topUses.length}: ${input.topUses.map((u) => `${u.file} (${u.count}회)`).join(", ")}`,
    );
  }
  lines.push(
    `// TODO: 원 구현을 옮기고 하드코딩 값 대신 ${input.tokensRef} 변수를 쓰세요. 이 파일은 dsmith가 다시 덮어쓰지 않습니다.`,
    "",
  );
  const props = [...input.props].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (props.length === 0) {
    lines.push(`export interface ${input.name}Props {}`);
  } else {
    lines.push(`export interface ${input.name}Props {`, ...props.map(propLine), "}");
  }
  lines.push(
    "",
    `export function ${input.name}(props: ${input.name}Props) {`,
    "  // TODO: 구현",
    "  return null;",
    "}",
    "",
  );
  return lines.join("\n");
}
