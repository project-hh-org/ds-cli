import { describe, expect, it } from "vitest";
import { readComponentProps } from "../src/component/props.js";

const F = "src/Button.tsx";

describe("readComponentProps", () => {
  it("인라인 타입 리터럴 매개변수에서 props를 읽는다", () => {
    const code = `export function Button({ children }: { children: ReactNode }) { return <button>{children}</button>; }`;
    expect(readComponentProps(code, F, "Button")).toEqual({
      props: [{ name: "children", type: "ReactNode", required: true }],
      inherits: [],
    });
  });

  it("interface + extends: 멤버는 required:false, extends는 inherits, keyof 타입은 values 없음", () => {
    const code = [
      `const variants = { primary: "", secondary: "" };`,
      `const sizes = { sm: "", md: "" };`,
      `interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {`,
      `  variant?: keyof typeof variants;`,
      `  size?: keyof typeof sizes;`,
      `}`,
      `export function Button({ variant, size }: ButtonProps) { return <button />; }`,
    ].join("\n");
    expect(readComponentProps(code, F, "Button")).toEqual({
      props: [
        { name: "variant", type: "keyof typeof variants", required: false },
        { name: "size", type: "keyof typeof sizes", required: false },
      ],
      inherits: ["ButtonHTMLAttributes<HTMLButtonElement>"],
    });
  });

  it("type 별칭의 교차 타입: 리터럴 부분은 멤버, 나머지는 inherits, 문자열 유니온은 values", () => {
    const code = [
      `type Props = A & { variant?: "primary" | "secondary" | "danger"; size?: "sm" | "md" };`,
      `export const Button = ({ variant }: Props) => <button />;`,
    ].join("\n");
    expect(readComponentProps(code, F, "Button")).toEqual({
      props: [
        { name: "variant", type: `"primary" | "secondary" | "danger"`, required: false, values: ["primary", "secondary", "danger"] },
        { name: "size", type: `"sm" | "md"`, required: false, values: ["sm", "md"] },
      ],
      inherits: ["A"],
    });
  });

  it("type 별칭이 타입 리터럴이면 멤버를 읽는다", () => {
    const code = `type Props = { label: string; onClick?: () => void };\nexport default function Button(p: Props) { return <button />; }`;
    expect(readComponentProps(code, F, "Button")).toEqual({
      props: [
        { name: "label", type: "string", required: true },
        { name: "onClick", type: "() => void", required: false },
      ],
      inherits: [],
    });
  });

  it("forwardRef<E, P>는 두 번째 타입 인자 P를 쓰고, React.forwardRef와 memo 한 겹도 푼다", () => {
    const a = `interface P { tone: "a" | "b" }\nexport const Button = forwardRef<HTMLButtonElement, P>((props, ref) => <button ref={ref} />);`;
    const b = a.replace("forwardRef", "React.forwardRef");
    const c = `interface P { tone: "a" | "b" }\nexport const Button = memo(forwardRef<HTMLButtonElement, P>((props, ref) => <button />));`;
    const expected = { props: [{ name: "tone", type: `"a" | "b"`, required: true, values: ["a", "b"] }], inherits: [] };
    expect(readComponentProps(a, F, "Button")).toEqual(expected);
    expect(readComponentProps(b, F, "Button")).toEqual(expected);
    expect(readComponentProps(c, F, "Button")).toEqual(expected);
  });

  it("forwardRef에 타입 인자가 없으면 내부 함수의 첫 매개변수 타입을 쓴다", () => {
    const code = `interface P { tone: string }\nexport const Button = forwardRef((props: P, ref) => <button />);`;
    expect(readComponentProps(code, F, "Button")?.props).toEqual([{ name: "tone", type: "string", required: true }]);
  });

  it("memo 안의 화살표 함수와 function 표현식을 읽는다", () => {
    const a = `export const Button = memo((p: { a: number }) => <b />);`;
    const b = `export const Button = function (p: { a: number }) { return <b />; };`;
    expect(readComponentProps(a, F, "Button")?.props).toEqual([{ name: "a", type: "number", required: true }]);
    expect(readComponentProps(b, F, "Button")?.props).toEqual([{ name: "a", type: "number", required: true }]);
  });

  it("타입 없는 매개변수는 null", () => {
    expect(readComponentProps(`export function X(props) { return <b />; }`, F, "X")).toBeNull();
  });

  it("이름이 다른 선언이 둘 이상이고 default도 없으면 null", () => {
    const code = `export function Other(p: { a: number }) { return <b />; }\nexport function Another(p: { b: number }) { return <b />; }`;
    expect(readComponentProps(code, F, "Button")).toBeNull();
  });

  it("같은 파일에서 못 찾는 타입(다른 파일·제네릭)은 null", () => {
    expect(readComponentProps(`import type { P } from "./types";\nexport function X(p: P) { return <b />; }`, F, "X")).toBeNull();
  });

  it(".ts 파일에서도 파싱한다", () => {
    expect(readComponentProps(`export const X = (p: { a?: string }) => null;`, "src/x.ts", "X")?.props).toEqual([
      { name: "a", type: "string", required: false },
    ]);
  });

  it("파싱할 수 없는 파일은 throw 없이 null", () => {
    expect(readComponentProps(`export function Button( { return`, F, "Button")).toBeNull();
    expect(readComponentProps(`@@@ <<<`, F, "Button")).toBeNull();
  });

  it("const X: FC<P> 타입 주석의 타입 인자를 쓴다(React. 유무, FunctionComponent, VFC)", () => {
    const expected = { props: [{ name: "tone", type: "string", required: true }], inherits: [] };
    for (const ann of ["React.FC<P>", "FC<P>", "FunctionComponent<P>", "React.FunctionComponent<P>", "VFC<P>"]) {
      const code = `interface P { tone: string }\nexport const Button: ${ann} = ({ tone }) => <b />;`;
      expect(readComponentProps(code, F, "Button"), ann).toEqual(expected);
    }
  });

  it("문자열 리터럴 유니온의 undefined·null은 values에서 뺀다", () => {
    const code = `export const X = (p: { a?: "x" | "y" | undefined; b: "z" | null; c: undefined }) => null;`;
    expect(readComponentProps(code, "src/x.ts", "X")?.props).toEqual([
      { name: "a", type: `"x" | "y" | undefined`, required: false, values: ["x", "y"] },
      { name: "b", type: `"z" | null`, required: true, values: ["z"] },
      { name: "c", type: "undefined", required: true },
    ]);
  });

  it("name이 선언돼 있지 않으면 export default를 읽는다(다른 이름으로 default import한 경우)", () => {
    const inline = `export default function Badge(p: { tone: string }) { return <b />; }`;
    const viaIdent = `const Badge = memo((p: { tone: string }) => <b />);\nexport default Badge;`;
    const anon = `export default function (p: { tone: string }) { return <b />; }`;
    for (const code of [inline, viaIdent, anon]) {
      expect(readComponentProps(code, F, "StatusBadge")?.props).toEqual([{ name: "tone", type: "string", required: true }]);
    }
  });

  it("default도 없으면 유일한 대문자 named export를 읽는다(import { Badge as StatusBadge })", () => {
    const code = `export const helper = 1;\nexport function Badge(p: { tone: string }) { return <b />; }`;
    expect(readComponentProps(code, F, "StatusBadge")?.props).toEqual([{ name: "tone", type: "string", required: true }]);
    const two = code + `\nexport function Chip(p: { a: string }) { return <b />; }`;
    expect(readComponentProps(two, F, "StatusBadge")).toBeNull();
  });

  it("name이 선언돼 있으나 타입을 못 읽으면 default로 대체하지 않는다", () => {
    const code = `export function Badge(p) { return <b />; }\nexport default function Other(p: { a: string }) { return <b />; }`;
    expect(readComponentProps(code, F, "Badge")).toBeNull();
  });
});
