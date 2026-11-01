import { describe, expect, it } from "vitest";
import { readComponentDoc, readComponentProps, readTypeProps } from "../src/component/props.js";

// 아래 MUI 발췌는 @mui/material 6.5.0 Button/Button.d.ts, 9.5.0 Button/Button.d.mts에서 가져온 것(MIT, Copyright Call-Em-All).
// 부록 B.4 참고.
const MUI6_BUTTON = String.raw`
import * as React from 'react';
import { OverridableStringUnion } from '@mui/types';
export interface ButtonPropsVariantOverrides {}

export interface ButtonPropsColorOverrides {}

export interface ButtonPropsSizeOverrides {}

export interface ButtonOwnProps {
  /**
   * The content of the component.
   */
  children?: React.ReactNode;
  /**
   * Override or extend the styles applied to the component.
   */
  classes?: Partial<ButtonClasses>;
  /**
   * The color of the component.
   * It supports both default and custom theme colors, which can be added as shown in the
   * [palette customization guide](https://mui.com/material-ui/customization/palette/#custom-colors).
   * @default 'primary'
   */
  color?: OverridableStringUnion<
    'inherit' | 'primary' | 'secondary' | 'success' | 'error' | 'info' | 'warning',
    ButtonPropsColorOverrides
  >;
  /**
   * If 'true', the component is disabled.
   * @default false
   */
  disabled?: boolean;
  /**
   * If 'true', no elevation is used.
   * @default false
   */
  disableElevation?: boolean;
  /**
   * If 'true', the  keyboard focus ripple is disabled.
   * @default false
   */
  disableFocusRipple?: boolean;
  /**
   * Element placed after the children.
   */
  endIcon?: React.ReactNode;
  /**
   * If 'true', the button will take up the full width of its container.
   * @default false
   */
  fullWidth?: boolean;
  /**
   * The URL to link to when the button is clicked.
   * If defined, an 'a' element will be used as the root node.
   */
  href?: string;
  /**
   * If 'true', the loading indicator is visible and the button is disabled.
   * If 'true | false', the loading wrapper is always rendered before the children to prevent [Google Translation Crash](https://github.com/mui/material-ui/issues/27853).
   * @default null
   */
  loading?: boolean | null;
  /**
   * Element placed before the children if the button is in loading state.
   * The node should contain an element with 'role="progressbar"' with an accessible name.
   * By default, it renders a 'CircularProgress' that is labeled by the button itself.
   * @default <CircularProgress color="inherit" size={16} />
   */
  loadingIndicator?: React.ReactNode;
  /**
   * The loading indicator can be positioned on the start, end, or the center of the button.
   * @default 'center'
   */
  loadingPosition?: 'start' | 'end' | 'center';
  /**
   * The size of the component.
   * 'small' is equivalent to the dense button styling.
   * @default 'medium'
   */
  size?: OverridableStringUnion<'small' | 'medium' | 'large', ButtonPropsSizeOverrides>;
  /**
   * Element placed before the children.
   */
  startIcon?: React.ReactNode;
  /**
   * The system prop that allows defining system overrides as well as additional CSS styles.
   */
  sx?: SxProps<Theme>;
  /**
   * The variant to use.
   * @default 'text'
   */
  variant?: OverridableStringUnion<'text' | 'outlined' | 'contained', ButtonPropsVariantOverrides>;
}

declare const Button: ExtendButtonBase<ButtonTypeMap>;
export default Button;
`;

const MUI9_BUTTON = String.raw`
import * as React from 'react';
export interface ButtonOwnProps {
  /**
   * The content of the component.
   */
  children?: React.ReactNode;
  /**
   * The color of the component.
   * @default 'primary'
   */
  color?: OverridableStringUnion<'inherit' | 'primary' | 'secondary' | 'success' | 'error' | 'info' | 'warning', ButtonPropsColorOverrides> | undefined;
  /**
   * If 'true', the component is disabled.
   * @default false
   */
  disabled?: boolean | undefined;
  /**
   * The loading indicator can be positioned on the start, end, or the center of the button.
   * @default 'center'
   */
  loadingPosition?: 'start' | 'end' | 'center' | undefined;
  /**
   * The size of the component.
   * @default 'medium'
   */
  size?: OverridableStringUnion<'small' | 'medium' | 'large', ButtonPropsSizeOverrides> | undefined;
  /**
   * The variant to use.
   * @default 'text'
   */
  variant?: OverridableStringUnion<'text' | 'outlined' | 'contained', ButtonPropsVariantOverrides> | undefined;
}
`;

const LEGACY_BUTTON = `
import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";

const variants = {
  default: "bg-brand text-white hover:bg-[#3C83F7]",
  outline: "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
  destructive: "bg-[#EF4444] text-white hover:bg-[#e53e3e]",
  ghost: "text-[#6B7280] hover:bg-gray-100",
};

const sizes = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export function Button({ variant = "default", size = "md", className, ...props }: ButtonProps) {
  return <button {...props} />;
}
`;

describe("JSDoc", () => {
  it("본문 첫 문단·@default·@deprecated를 읽는다", () => {
    const code = [
      `interface P {`,
      `  /** 크기\n   * @default 'md' */`,
      `  size?: "sm" | "md";`,
      `  /** @deprecated tone을 쓰세요 */`,
      `  color?: string;`,
      `  /**\n   * 첫 줄\n   * 이어지는 줄\n   *\n   * 두 번째 문단\n   */`,
      `  label?: string;`,
      `  /** @deprecated */`,
      `  old?: string;`,
      `  /* 일반 주석 */`,
      `  plain?: string;`,
      `}`,
      `export function X(p: P) { return null; }`,
    ].join("\n");
    const props = readComponentProps(code, "X.tsx", "X")?.props ?? [];
    expect(props[0]).toEqual({ name: "size", type: '"sm" | "md"', required: false, values: ["sm", "md"], description: "크기", default: "'md'" });
    expect(props[1]).toEqual({ name: "color", type: "string", required: false, deprecated: "tone을 쓰세요" });
    expect(props[2]?.description).toBe("첫 줄 이어지는 줄");
    expect(props[3]?.deprecated).toBe("deprecated");
    expect(props[4]).toEqual({ name: "plain", type: "string", required: false });
  });

  it("설명은 200자로 자르고 …를 붙인다", () => {
    const long = "가".repeat(300);
    const code = `interface P {\n  /** ${long} */\n  a?: string;\n}\nexport function X(p: P) { return null; }`;
    const d = readComponentProps(code, "X.tsx", "X")?.props[0]?.description ?? "";
    expect(d.length).toBe(200);
    expect(d.endsWith("…")).toBe(true);
  });
});

describe("values: 래퍼 유니온·keyof typeof", () => {
  const read = (type: string): string[] | undefined => {
    const code = `interface P { a?: ${type} }\nexport function X(p: P) { return null; }`;
    return readComponentProps(code, "X.tsx", "X")?.props[0]?.values;
  };
  it("OverridableStringUnion은 첫 타입 인자를 펼친다", () => {
    expect(read(`OverridableStringUnion<'text' | 'outlined' | 'contained', X> | undefined`)).toEqual(["text", "outlined", "contained"]);
  });
  it("NonNullable은 첫 타입 인자를 펼친다", () => {
    expect(read(`NonNullable<"a" | "b" | null>`)).toEqual(["a", "b"]);
  });
  it("그 외 타입이 섞이면 values 없음", () => {
    expect(read(`Record<"a", "b">`)).toBeUndefined();
    expect(read(`"a" | number`)).toBeUndefined();
  });
  it("중복은 제거하고 선언 순서를 유지한다", () => {
    expect(read(`"b" | "a" | "b"`)).toEqual(["b", "a"]);
  });
  it("keyof typeof X: 같은 파일 const 객체의 키 (legacy-demo button.tsx)", () => {
    const props = readComponentProps(LEGACY_BUTTON, "button.tsx", "Button")?.props ?? [];
    expect(props.find((p) => p.name === "variant")?.values).toEqual(["default", "outline", "destructive", "ghost"]);
    expect(props.find((p) => p.name === "size")?.values).toEqual(["sm", "md", "lg"]);
    expect(props.find((p) => p.name === "size")?.type).toBe("keyof typeof sizes");
  });
  it("as const·문자열 키·없는 const", () => {
    const code = [
      `const t = { "a-b": 1, c: 2 } as const;`,
      `interface P { x?: keyof typeof t; y?: keyof typeof missing }`,
      `export function X(p: P) { return null; }`,
    ].join("\n");
    const props = readComponentProps(code, "X.tsx", "X")?.props ?? [];
    expect(props[0]?.values).toEqual(["a-b", "c"]);
    expect(props[1]?.values).toBeUndefined();
  });
});

describe("readTypeProps", () => {
  it("MUI 6.5 ButtonOwnProps: 16개, variant·size·color values", () => {
    const r = readTypeProps(MUI6_BUTTON, "Button.d.ts", "ButtonOwnProps");
    expect(r?.props).toHaveLength(16);
    const by = (n: string) => r?.props.find((p) => p.name === n);
    expect(by("variant")?.values).toEqual(["text", "outlined", "contained"]);
    expect(by("size")?.values).toEqual(["small", "medium", "large"]);
    expect(by("color")?.values).toEqual(["inherit", "primary", "secondary", "success", "error", "info", "warning"]);
    expect(by("loadingPosition")?.values).toEqual(["start", "end", "center"]);
    expect(by("variant")?.default).toBe("'text'");
    expect(by("href")?.description).toContain("The URL to link to");
    expect(by("children")?.required).toBe(false);
  });
  it("MUI 9.5 .d.mts 발췌(`| undefined`)도 같은 values", () => {
    const r = readTypeProps(MUI9_BUTTON, "Button.d.mts", "ButtonOwnProps");
    expect(r?.props).toHaveLength(6);
    expect(r?.props.find((p) => p.name === "variant")?.values).toEqual(["text", "outlined", "contained"]);
    expect(r?.props.find((p) => p.name === "loadingPosition")?.values).toEqual(["start", "end", "center"]);
    expect(r?.props.find((p) => p.name === "disabled")?.type).toBe("boolean | undefined");
  });
  it("type 별칭 리터럴·교차 타입, 없는 이름·제네릭은 null", () => {
    const code = `type A = { a: string } & Base;\ninterface G<T> { x: T }`;
    expect(readTypeProps(code, "a.d.ts", "A")).toEqual({ props: [{ name: "a", type: "string", required: true }], inherits: ["Base"] });
    expect(readTypeProps(code, "a.d.ts", "G")).toBeNull();
    expect(readTypeProps(code, "a.d.ts", "Nope")).toBeNull();
  });
});

describe("readComponentDoc", () => {
  it("export 함수의 JSDoc", () => {
    const code = `/** 오래됨\n * @deprecated NewX를 쓰세요 */\nexport function X(){}`;
    expect(readComponentDoc(code, "X.tsx", "X")).toEqual({ description: "오래됨", deprecated: "NewX를 쓰세요" });
  });
  it("const·declare const·JSDoc 없음·선언 없음", () => {
    expect(readComponentDoc(`/** 설명 */\nexport const Y = () => null;`, "Y.tsx", "Y")).toEqual({ description: "설명" });
    expect(readComponentDoc(`/**\n * Demos:\n */\ndeclare const Button: T;`, "Button.d.ts", "Button")).toEqual({ description: "Demos:" });
    expect(readComponentDoc(`export function Z(){}`, "Z.tsx", "Z")).toBeNull();
    expect(readComponentDoc(`export function Z(){}`, "Z.tsx", "Q")).toBeNull();
  });
});
