/** MUI 기본 테마 `theme.spacing()` 단위(px). */
export const SPACING_UNIT_PX = 8;

/** MUI 기본 테마 `theme.shape.borderRadius`(px). `sx={{ borderRadius: 1 }}`은 이 값의 배수다. */
export const SHAPE_BORDER_RADIUS_PX = 4;

/** 숫자 값이 `theme.spacing()` 배수로 해석되는 sx 키 중 짧은 약어와 gap 계열. */
const SHORT_SPACING_PROPS = [
  "p", "px", "py", "pt", "pr", "pb", "pl",
  "m", "mx", "my", "mt", "mr", "mb", "ml",
  "gap", "rowGap", "columnGap",
] as const;

const SPACING_SIDES = ["Top", "Right", "Bottom", "Left", "X", "Y", "Inline", "InlineStart", "InlineEnd", "Block", "BlockStart", "BlockEnd"];

/** 숫자 값이 `theme.spacing()` 배수로 해석되는 sx 키(약어, gap 계열, `padding*`/`margin*` 장문 키). 판정은 `isSpacingProp`. */
export const SPACING_PROPS: readonly string[] = [
  ...SHORT_SPACING_PROPS,
  "padding",
  "margin",
  ...["padding", "margin"].flatMap((base) => SPACING_SIDES.map((side) => `${base}${side}`)),
];

const SHORT_SPACING: ReadonlySet<string> = new Set(SHORT_SPACING_PROPS);

/** MUI는 모든 `padding*`/`margin*` 키와 약어·gap 계열에 spacing 변환을 적용한다. */
export function isSpacingProp(key: string): boolean {
  return SHORT_SPACING.has(key) || /^(padding|margin)/.test(key);
}

/** `sx={{ p: 2 }}`의 2를 px로 바꾼다. */
export function spacingToPx(n: number, unit: number = SPACING_UNIT_PX): number {
  return n * unit;
}

const PALETTE_PATH = /^(primary|secondary|error|warning|info|success|text|background|grey|common|divider|action)(\.[a-zA-Z0-9]+)*$/;

/** `"primary.main"`, `"grey.500"` 같은 `theme.palette` 경로 문자열인지. */
export function isPalettePath(v: string): boolean {
  return PALETTE_PATH.test(v);
}

/** sx 약어 키 → CSS 속성명. 여기에 없는 키(`display`, `typography` 등)는 그대로 둔다. */
export const MUI_KEY_MAP: Readonly<Record<string, string>> = {
  p: "padding",
  px: "padding-inline",
  py: "padding-block",
  pt: "padding-top",
  pr: "padding-right",
  pb: "padding-bottom",
  pl: "padding-left",
  m: "margin",
  mx: "margin-inline",
  my: "margin-block",
  mt: "margin-top",
  mr: "margin-right",
  mb: "margin-bottom",
  ml: "margin-left",
  bgcolor: "background-color",
  fontSize: "font-size",
  borderRadius: "border-radius",
};
