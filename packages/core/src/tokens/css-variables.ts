import { colorsNamed } from "culori";
import type { Token } from "../model/token.js";
import { normalizeColor } from "../normalize/color.js";
import { normalizeLength } from "../normalize/length.js";
import { parseCssDeclarations } from "../parse/css-text.js";

const VAR_REFERENCE = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*))?\)$/;
const MAX_VAR_DEPTH = 5;

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(/i;
/** shadcn v3의 `--background: 222.2 84% 4.9%` 처럼 hsl() 없이 쓰는 삼중항 */
const HSL_TRIPLET = /^\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%$/;
const LENGTH_WITH_UNIT = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em)$/i;
const BARE_ZERO = /^-?0*\.?0+$/;

/** 길이처럼 보여도 spacing/radius/font-size가 아닌 변수(`--blur-sm: 8px`, `--breakpoint-sm: 40rem`, `--text-sm--line-height` …) */
const NON_SIZE_NAME =
  /blur|weight|leading|line-height|tracking|letter-spacing|^--z-|opacity|duration|breakpoint|container|perspective|border-width/i;
const RADIUS_NAME = /radius|rounded/i;
const FONT_SIZE_NAME = /^--(?:font-size|text|fs)-/i;

function colorOf(value: string) {
  const text = value.trim();
  if (HSL_TRIPLET.test(text)) return normalizeColor(`hsl(${text})`);
  const looksLikeColor =
    HEX_COLOR.test(text) ||
    COLOR_FUNCTION.test(text) ||
    Object.hasOwn(colorsNamed, text.toLowerCase());
  return looksLikeColor ? normalizeColor(text) : null;
}

function lengthOf(value: string): number | null {
  const text = value.trim();
  return LENGTH_WITH_UNIT.test(text) || BARE_ZERO.test(text) ? normalizeLength(text) : null;
}

function lengthCategory(name: string): Token["category"] | null {
  if (NON_SIZE_NAME.test(name)) return null;
  if (RADIUS_NAME.test(name)) return "radius";
  if (FONT_SIZE_NAME.test(name)) return "font-size";
  return "spacing";
}

/**
 * 값이 `var(--x)`/`var(--x, 대체값)`이면 별칭 표에서 최대 5단계까지(순환이면 중단) 따라가 최종 값을 돌려준다.
 * 참조가 없으면 대체값을 쓰고, 대체값도 없으면 null.
 */
function resolveValue(value: string, aliases: ReadonlyMap<string, string>): string | null {
  let current = value.trim();
  const visited = new Set<string>();
  for (let depth = 0; depth <= MAX_VAR_DEPTH; depth++) {
    const reference = VAR_REFERENCE.exec(current);
    if (reference === null) return current;
    const name = reference[1]!;
    if (visited.has(name)) return null;
    visited.add(name);
    const target = aliases.get(name);
    if (target !== undefined) current = target.trim();
    else if (reference[2] !== undefined && reference[2].trim() !== "") current = reference[2].trim();
    else return null;
  }
  return null;
}

/**
 * 파일의 `--name: value` 선언을 이름 → 원문 값으로 모은다(블록 무관, 같은 이름은 먼저 나온 선언만).
 * 여러 파일을 읽을 때는 이 표를 합쳐 `readCssVariableTokens`의 `aliases`로 넘기면 파일 사이의 var() 참조도 풀린다.
 */
export function collectCssVariables(code: string, file: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of parseCssDeclarations(code, 0, { lineComments: /\.scss$/i.test(file) })) {
    if (!decl.property.startsWith("--") || decl.dynamic || out.has(decl.property)) continue;
    out.set(decl.property, decl.value);
  }
  return out;
}

/**
 * CSS/SCSS 텍스트의 `--name: value` 선언을 토큰으로 읽는다(블록 무관, 파일 등장 순).
 *
 * - 같은 이름이 여러 번 나오면 **첫 선언만** 쓴다. 첫 선언이 라이트 모드라고 가정한다
 *   (shadcn은 `:root`가 `.dark`보다 앞, v4의 `@theme inline`은 `:root` 앞이다).
 * - 값이 `var(--x)`·`var(--x, 대체값)`이면 같은 파일(+ `aliases`)의 변수로 최대 5단계 해석한다.
 * - 색은 `#hex`·색 함수·CSS 색 이름·hsl 삼중항(`222 47% 11%`)만 인정한다. 숫자만 있는 값(`700`)은 색이 아니다.
 * - 길이는 px/rem/em 단위가 있어야 한다(맨 `0`은 허용). blur·weight·z-index 같은 이름은 분류하지 않고 버린다.
 * - scss `$변수`는 읽지 않는다(CSS 커스텀 속성만).
 */
export function readCssVariableTokens(
  code: string,
  file: string,
  aliases: ReadonlyMap<string, string> = new Map(),
): Token[] {
  const local = collectCssVariables(code, file);
  const table = new Map<string, string>([...aliases, ...local]);

  const tokens: Token[] = [];
  for (const [name, value] of local) {
    const resolved = resolveValue(value, table);
    if (resolved === null) continue;

    const color = colorOf(resolved);
    if (color !== null) {
      tokens.push({ name, value, normalized: color, category: "color" });
      continue;
    }
    const px = lengthOf(resolved);
    const category = px === null ? null : lengthCategory(name);
    if (px !== null && category !== null) {
      tokens.push({ name, value, normalized: { kind: "length", px }, category });
    }
  }
  return tokens;
}
