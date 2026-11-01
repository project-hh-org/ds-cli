import type { Token } from "../model/token.js";
import { normalizeColor } from "../normalize/color.js";
import { normalizeLength } from "../normalize/length.js";
import { parseCssDeclarations } from "../parse/css-text.js";

const VAR_REFERENCE = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/;
const RADIUS_NAME = /radius|rounded/i;
const FONT_SIZE_NAME = /font-size|text-|fs-/i;

function lengthCategory(name: string): Token["category"] {
  if (RADIUS_NAME.test(name)) return "radius";
  if (FONT_SIZE_NAME.test(name)) return "font-size";
  return "spacing";
}

/**
 * CSS/SCSS 텍스트의 `--name: value` 선언을 토큰으로 읽는다(블록 무관, 파일 등장 순, 같은 이름은 먼저 나온 선언만).
 * 값이 `var(--x)` 하나면 같은 파일의 `--x`로 1단계 해석한다. 색·길이로 정규화되지 않는 값은 버린다.
 */
export function readCssVariableTokens(code: string, file: string): Token[] {
  const decls = parseCssDeclarations(code, 0, { lineComments: /\.scss$/i.test(file) }).filter(
    (decl) => decl.property.startsWith("--") && !decl.dynamic,
  );

  const rawByName = new Map<string, string>();
  for (const decl of decls) rawByName.set(decl.property, decl.value);

  const tokens: Token[] = [];
  const seen = new Set<string>();
  for (const decl of decls) {
    if (seen.has(decl.property)) continue;
    const reference = VAR_REFERENCE.exec(decl.value);
    const resolved = reference === null ? decl.value : (rawByName.get(reference[1]!) ?? "");

    const color = normalizeColor(resolved);
    if (color !== null) {
      seen.add(decl.property);
      tokens.push({ name: decl.property, value: decl.value, normalized: color, category: "color" });
      continue;
    }
    const px = normalizeLength(resolved);
    if (px !== null) {
      seen.add(decl.property);
      tokens.push({
        name: decl.property,
        value: decl.value,
        normalized: { kind: "length", px },
        category: lengthCategory(decl.property),
      });
    }
  }
  return tokens;
}
