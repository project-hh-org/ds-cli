import { applyPatches, partitionPatches, validateEdit, type TsPaths } from "@dsmith-dev/core";
import { describe, expect, it } from "vitest";
import { planComponentEdits, type ChosenTarget } from "../src/components.js";

const tsPaths: TsPaths = { baseUrl: "", baseUrlExplicit: true, paths: { "@/*": ["./src/*"] } };
const FILE = "app/page.tsx";

const OLD = "src/components/Button";
const OLD2 = "src/legacy/Button";
const DS = "src/components/ui/button";

function target(p: Partial<ChosenTarget> = {}): ChosenTarget {
  return {
    item: "Button",
    kind: "duplicate",
    module: DS,
    file: `${DS}.tsx`,
    exportKind: "named",
    props: ["variant", "size", "loading"],
    mapping: {},
    options: [OLD, OLD2, DS],
    ...p,
  };
}

function run(code: string, targets: ChosenTarget[], file = FILE) {
  const result = planComponentEdits({ file, code, targets, tsPaths, moduleContext: {} });
  const accepted = partitionPatches(result.edits.map((e) => e.patch));
  expect(accepted.conflicts).toEqual([]);
  const after = applyPatches(code, accepted.accepted);
  // 모든 출력은 구문 오류가 늘지 않는다
  expect(validateEdit(file, code, after)).toEqual({ ok: true });
  return { ...result, after };
}

describe("planComponentEdits: duplicate import", () => {
  it("지정자가 하나면 선언 전체를 DS import로 교체한다(별칭 경로)", () => {
    const code = 'import { Button } from "../src/components/Button";\n\nexport const A = () => <Button size="sm">x</Button>;\n';
    const { after, edits, held } = run(code, [target()]);
    expect(after).toBe('import { Button } from "@/components/ui/button";\n\nexport const A = () => <Button size="sm">x</Button>;\n');
    expect(held).toEqual([]);
    expect(edits.every((e) => e.item === "Button" && e.file === FILE)).toBe(true);
    expect(edits.map((e) => e.kind)).toContain("import");
  });

  it("따옴표·세미콜론 스타일을 따른다", () => {
    const code = "import { Button } from '../src/components/Button'\nexport const A = () => <Button />\n";
    expect(run(code, [target()]).after).toBe("import { Button } from '@/components/ui/button'\nexport const A = () => <Button />\n");
  });

  it("지정자가 여럿이면 그 지정자만 지우고 선언 다음 줄에 새 import를 넣는다", () => {
    const code = 'import { Button, Card } from "../src/components/Button";\nexport const A = () => <Button />;\n';
    const { after } = run(code, [target()]);
    expect(after).toBe('import { Card } from "../src/components/Button";\nimport { Button } from "@/components/ui/button";\nexport const A = () => <Button />;\n');
  });

  it("마지막 지정자를 지울 때는 앞 쉼표를 지운다", () => {
    const code = 'import { Card, Button } from "../src/components/Button";\nexport const A = () => <Button />;\n';
    expect(run(code, [target()]).after).toBe('import { Card } from "../src/components/Button";\nimport { Button } from "@/components/ui/button";\nexport const A = () => <Button />;\n');
  });

  it("여러 줄 import에서도 서식을 해치지 않는다", () => {
    const code = 'import {\n  Card,\n  Button,\n} from "../src/components/Button";\nexport const A = () => <Button />;\n';
    expect(run(code, [target()]).after).toBe('import {\n  Card,\n} from "../src/components/Button";\nimport { Button } from "@/components/ui/button";\nexport const A = () => <Button />;\n');
  });

  it("파일에 이미 DS import가 있으면 그 { } 끝에 합친다", () => {
    const code = 'import { Card } from "@/components/ui/card";\nimport { Dialog } from "@/components/ui/button";\nimport { Button } from "../src/components/Button";\nexport const A = () => <Button />;\n';
    const { after } = run(code, [target()]);
    expect(after).toBe('import { Card } from "@/components/ui/card";\nimport { Dialog, Button } from "@/components/ui/button";\nexport const A = () => <Button />;\n');
  });

  it("별칭(as)을 유지한다", () => {
    const code = 'import { Button as Btn, Card } from "../src/components/Button";\nexport const A = () => <Btn />;\n';
    const { after } = run(code, [target()]);
    expect(after).toContain('import { Button as Btn } from "@/components/ui/button";');
    expect(after).toContain('import { Card } from "../src/components/Button";');
  });

  it("default 가져오기 → named 대상: import { Name } 로 바꾼다", () => {
    const code = 'import Button from "../src/components/Button";\nexport const A = () => <Button />;\n';
    expect(run(code, [target()]).after).toBe('import { Button } from "@/components/ui/button";\nexport const A = () => <Button />;\n');
  });

  it("named 가져오기 → default 대상: import Name from 으로 바꾼다", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = () => <Button />;\n';
    expect(run(code, [target({ exportKind: "default" })]).after).toBe('import Button from "@/components/ui/button";\nexport const A = () => <Button />;\n');
  });

  it("옵션이 아닌 module이나 이미 고른 module에서 온 import는 건드리지 않는다", () => {
    const code = 'import { Button } from "@/components/ui/button";\nimport { Button as B2 } from "react-aria";\nexport const A = () => <Button />;\n';
    const r = run(code, [target()]);
    expect(r.edits).toEqual([]);
    expect(r.held).toEqual([]);
  });

  it("고른 정의 파일 자신은 건드리지 않는다", () => {
    const code = 'import { Button } from "../Button";\nexport const A = () => <Button />;\n';
    expect(run(code, [target()], `${DS}.tsx`).edits).toEqual([]);
  });

  it("import type은 건드리지 않는다(선언·지정자 모두)", () => {
    const code = 'import type { Button } from "../src/components/Button";\nimport { type Button as BT, Card } from "../src/components/Button";\nexport type T = Button | BT;\n';
    const r = run(code, [target()]);
    expect(r.edits).toEqual([]);
    expect(r.held).toEqual([]);
  });

  it("값 import와 타입 지정자가 섞이면 값 지정자만 옮긴다", () => {
    const code = 'import { type ButtonProps, Button } from "../src/components/Button";\nexport const A = () => <Button />;\n';
    const { after } = run(code, [target()]);
    expect(after).toBe('import { type ButtonProps } from "../src/components/Button";\nimport { Button } from "@/components/ui/button";\nexport const A = () => <Button />;\n');
  });

  it("default와 named가 함께 있는 선언에서 named만 옮긴다", () => {
    const code = 'import React, { Button } from "../src/components/Button";\nexport const A = () => <Button />;\n';
    expect(run(code, [target()]).after).toBe('import React from "../src/components/Button";\nimport { Button } from "@/components/ui/button";\nexport const A = () => <Button />;\n');
  });

  it("같은 선언에서 두 항목을 함께 옮기면 선언이 사라지고 새 줄만 남는다", () => {
    const code = 'import { Button, Badge } from "../src/legacy/Shared";\nexport const A = () => <><Button /><Badge /></>;\n';
    const badge = target({ item: "Badge", module: "src/components/ui/badge", file: "src/components/ui/badge.tsx", options: ["src/legacy/Shared", "src/components/ui/badge"], props: null });
    const button = target({ options: ["src/legacy/Shared", DS], props: null });
    const { after } = run(code, [button, badge]);
    expect(after).toBe('import { Button } from "@/components/ui/button";\nimport { Badge } from "@/components/ui/badge";\nexport const A = () => <><Button /><Badge /></>;\n');
  });

  it("같은 선언에서 일부만 옮기면 나머지는 남는다(인접 지정자도 겹치지 않음)", () => {
    const code = 'import { A1, Button, Badge, Z9 } from "../src/legacy/Shared";\nexport const A = () => <><Button /><Badge /></>;\n';
    const badge = target({ item: "Badge", module: "src/components/ui/badge", file: "src/components/ui/badge.tsx", options: ["src/legacy/Shared", "src/components/ui/badge"], props: null });
    const button = target({ options: ["src/legacy/Shared", DS], props: null });
    const { after } = run(code, [button, badge]);
    expect(after).toBe('import { A1, Z9 } from "../src/legacy/Shared";\nimport { Button } from "@/components/ui/button";\nimport { Badge } from "@/components/ui/badge";\nexport const A = () => <><Button /><Badge /></>;\n');
    const tail = 'import { A1, Button, Badge } from "../src/legacy/Shared";\nexport const A = () => <><Button /><Badge /></>;\n';
    expect(run(tail, [button, badge]).after).toBe('import { A1 } from "../src/legacy/Shared";\nimport { Button } from "@/components/ui/button";\nimport { Badge } from "@/components/ui/badge";\nexport const A = () => <><Button /><Badge /></>;\n');
  });

  it("같은 선언을 공유하는 항목은 같은 group이다", () => {
    const code = 'import { Button, Badge } from "../src/legacy/Shared";\nexport const A = () => <><Button /><Badge /></>;\n';
    const badge = target({ item: "Badge", module: "src/components/ui/badge", file: "src/components/ui/badge.tsx", options: ["src/legacy/Shared", "src/components/ui/badge"], props: null });
    const button = target({ options: ["src/legacy/Shared", DS], props: null });
    const { edits } = run(code, [button, badge]);
    expect(new Set(edits.map((e) => e.group)).size).toBe(1);
  });

  it("export를 모르면(exportKind null) export-unknown으로 보류하고 무변경", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = () => <Button />;\n';
    const r = run(code, [target({ exportKind: null })]);
    expect(r.edits).toEqual([]);
    expect(r.held).toHaveLength(1);
    expect(r.held[0]).toMatchObject({ item: "Button", file: FILE, line: 1, reason: "export-unknown" });
  });

  it("가져오는 이름이 item과 다르면(Foo as Button) export-unknown", () => {
    const code = 'import { Foo as Button } from "../src/components/Button";\nexport const A = () => <Button />;\n';
    expect(run(code, [target()]).held[0]?.reason).toBe("export-unknown");
  });
});

describe("planComponentEdits: props", () => {
  it("{...props} 스프레드가 있으면 spread-props로 그 파일의 그 항목 전부를 보류한다", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = (p: any) => <><Button {...p} /><Button size="sm" /></>;\n';
    const r = run(code, [target()]);
    expect(r.edits).toEqual([]);
    expect(r.held).toHaveLength(1);
    expect(r.held[0]).toMatchObject({ reason: "spread-props", item: "Button" });
  });

  it("대상 정의에 없는 prop은 mapping-missing이고 detail에 빠진 이름이 있다", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = () => <Button kind="x" tone="y" size="sm" />;\n';
    const r = run(code, [target()]);
    expect(r.edits).toEqual([]);
    expect(r.held[0]).toMatchObject({ reason: "mapping-missing" });
    expect(r.held[0]?.detail).toContain("kind");
    expect(r.held[0]?.detail).toContain("tone");
    expect(r.held[0]?.detail).not.toContain("size");
  });

  it("key·ref·children·className·style·aria-*·data-*는 통과한다", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = () => <Button key="k" ref={r} className="c" style={{}} aria-label="a" data-x="1" size="sm" />;\n';
    expect(run(code, [target()]).held).toEqual([]);
  });

  it("props를 모르면(null) 검사하지 않는다", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = () => <Button whatever={1} />;\n';
    const r = run(code, [target({ props: null })]);
    expect(r.held).toEqual([]);
    expect(r.edits.length).toBeGreaterThan(0);
  });

  it("상속한 네이티브 속성(onClick·disabled 등)은 통과한다", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = () => <Button onClick={f} disabled type="submit" size="sm" />;\n';
    expect(run(code, [target({ inherits: ["ButtonHTMLAttributes<HTMLButtonElement>"] })]).held).toEqual([]);
    expect(run(code, [target()]).held[0]?.reason).toBe("mapping-missing");
  });

  it("mapping으로 prop 이름을 바꾼다", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = () => <Button kind="primary" size="sm">x</Button>;\n';
    const r = run(code, [target({ mapping: { kind: "variant" } })]);
    expect(r.held).toEqual([]);
    expect(r.after).toContain('<Button variant="primary" size="sm">x</Button>');
    expect(r.edits.filter((e) => e.kind === "prop")).toHaveLength(1);
  });

  it("prop=value 매핑은 이름과 문자열 값을 함께 바꾼다(값 매핑이 이름 매핑보다 먼저)", () => {
    const code = "import { Button } from \"../src/components/Button\";\nexport const A = () => <><Button variant=\"primary\" /><Button variant='danger' /></>;\n";
    const mapping = { "variant=primary": "variant=default", "variant=danger": "tone=destructive" };
    const r = run(code, [target({ mapping, props: ["variant", "tone"] })]);
    expect(r.held).toEqual([]);
    expect(r.after).toContain('<Button variant="default" />');
    expect(r.after).toContain("<Button tone='destructive' />");
  });

  it("정의의 허용 값에 없는 문자열 값은 mapping-missing(값 매핑을 주면 통과)", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = () => <Button variant="secondary" size="sm" />;\n';
    const t = target({ propValues: { variant: ["default", "outline"] } });
    const missing = run(code, [t]);
    expect(missing.edits).toEqual([]);
    expect(missing.held[0]).toMatchObject({ reason: "mapping-missing" });
    expect(missing.held[0]?.detail).toContain('variant="secondary"');
    const mapped = run(code, [{ ...t, mapping: { "variant=secondary": "variant=outline" } }]);
    expect(mapped.held).toEqual([]);
    expect(mapped.after).toContain('<Button variant="outline" size="sm" />');
  });

  it("prop=value 매핑만 있고 값이 표현식이면 이름만 보고 통과시키지 않는다", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const A = (v: string) => <Button variant={v} />;\n';
    const t = target({ mapping: { "variant=primary": "variant=default" } });
    expect(run(code, [t]).held[0]?.reason).toBe("mapping-missing");
  });

  it("다른 항목 이름의 JSX나 같은 이름의 지역 변수는 보지 않는다", () => {
    const code = 'import { Button } from "../src/components/Button";\nimport { Card } from "./Card";\nexport const A = () => <><Card whatever={1} /><Button size="sm" /></>;\n';
    expect(run(code, [target()]).held).toEqual([]);
  });

  it("import만 있고 JSX가 없어도 import는 바뀐다", () => {
    const code = 'import { Button } from "../src/components/Button";\nexport const B = 1;\n';
    expect(run(code, [target()]).after).toContain('"@/components/ui/button"');
  });
});

describe("planComponentEdits: local-definition", () => {
  const local = (p: Partial<ChosenTarget> = {}): ChosenTarget =>
    target({ kind: "local-definition", module: "src/components/Badge", file: "src/components/Badge.tsx", options: ["src/components/Badge.tsx", "src/pages/Orders.tsx"], item: "Badge", ...p });

  it("고른 파일이 아닌 파일의 최상위 선언 줄 위에 주석 한 줄만 넣는다(삭제·import 추가 없음)", () => {
    const code = 'const x = 1;\nfunction Badge({ children }: { children: string }) {\n  return <span>{children}</span>;\n}\nexport const O = () => <Badge>a</Badge>;\n';
    const { after, edits } = run(code, [local()], "src/pages/Orders.tsx");
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ kind: "annotate", item: "Badge", line: 2 });
    expect(after).toBe(
      'const x = 1;\n// dsmith: src/components/Badge.tsx로 통합됨 — 삭제 검토 (import { Badge } from "@/components/Badge")\nfunction Badge({ children }: { children: string }) {\n  return <span>{children}</span>;\n}\nexport const O = () => <Badge>a</Badge>;\n',
    );
    expect(after.split("\n").length).toBe(code.split("\n").length + 1);
  });

  it("export const / class / export function 선언도 찾고 들여쓰기를 따른다", () => {
    for (const decl of ["export const Badge = () => <i />;", "export default function Badge() { return <i />; }", "class Badge extends Component {}"]) {
      const code = `${decl}\n`;
      const { after, edits } = run(code, [local()], "src/pages/Orders.tsx");
      expect(edits, decl).toHaveLength(1);
      expect(after.startsWith("// dsmith: ")).toBe(true);
      expect(after.endsWith(`\n${decl}\n`)).toBe(true);
    }
  });

  it("두 번째 실행에서는 주석이 중복되지 않는다", () => {
    const code = 'function Badge() { return <i />; }\n';
    const once = run(code, [local()], "src/pages/Orders.tsx").after;
    const twice = run(once, [local()], "src/pages/Orders.tsx");
    expect(twice.edits).toEqual([]);
    expect(twice.after).toBe(once);
  });

  it("고른 파일 자체와 옵션이 아닌 파일, import로 가져온 파일은 건드리지 않는다", () => {
    const decl = "function Badge() { return <i />; }\n";
    expect(run(decl, [local()], "src/components/Badge.tsx").edits).toEqual([]);
    expect(run(decl, [local()], "src/other.tsx").edits).toEqual([]);
    expect(run(`import { Badge } from "./x";\n`, [local()], "src/pages/Orders.tsx").edits).toEqual([]);
  });

  it("package 대상의 주석은 패키지 specifier를 쓴다", () => {
    const t = local({ module: "@acme/ds", file: null, exportKind: "named" });
    const { after } = run("function Badge() { return <i />; }\n", [t], "src/pages/Orders.tsx");
    expect(after).toContain('(import { Badge } from "@acme/ds")');
  });
});

const BUTTON_IMPORT = 'import { Button } from "../src/components/Button";\n';
const allowed = { propValues: { variant: ["default", "outline", "destructive"] } };

describe("planComponentEdits: 표현식 안의 문자열 값 (Imp1)", () => {
  const held = (jsx: string, t: Partial<ChosenTarget> = {}) => run(`${BUTTON_IMPORT}export const A = (c: boolean, d: string) => ${jsx};\n`, [target({ ...allowed, ...t })]);

  it("variant={\"secondary\"}·무치환 템플릿 리터럴도 허용 값 검사를 받는다", () => {
    for (const jsx of ['<Button variant={"secondary"} />', "<Button variant={`secondary`} />"]) {
      const r = held(jsx);
      expect(r.edits, jsx).toEqual([]);
      expect(r.held[0], jsx).toMatchObject({ reason: "mapping-missing" });
      expect(r.held[0]?.detail, jsx).toContain('variant="secondary"');
    }
  });

  it("허용되는 값의 표현식 리터럴은 통과한다", () => {
    for (const jsx of ['<Button variant={"outline"} />', "<Button variant={`outline`} />", '<Button variant={c ? "default" : "outline"} />']) {
      expect(held(jsx).held, jsx).toEqual([]);
    }
  });

  it("조건·논리 표현식은 리터럴 잎마다 검사한다", () => {
    const cond = held('<Button variant={c ? "default" : "secondary"} />');
    expect(cond.held[0]?.detail).toContain('variant="secondary"');
    expect(cond.held[0]?.detail).not.toContain('variant="default"');
    const logical = held('<Button variant={d || "danger"} />');
    expect(logical.held[0]?.reason).toBe("mapping-missing");
    const nested = held('<Button variant={c ? (d ? "outline" : "ghost") : "default"} />');
    expect(nested.held[0]?.detail).toContain('variant="ghost"');
  });

  it("검증할 수 없는 표현식은 동적 값으로 보류한다(허용 값이 정해진 prop만)", () => {
    for (const jsx of ["<Button variant={d} />", '<Button variant={c ? d : "default"} />', "<Button variant={getVariant()} />"]) {
      const r = held(jsx);
      expect(r.held[0], jsx).toMatchObject({ reason: "mapping-missing" });
      expect(r.held[0]?.detail, jsx).toContain("동적 값: variant");
    }
    // 허용 값이 없는 prop·네이티브 prop은 표현식이어도 통과
    expect(held("<Button size={d} onClick={d} />", { inherits: ["ButtonHTMLAttributes<HTMLButtonElement>"] }).held).toEqual([]);
  });

  it("이름을 바꾼 뒤의 prop에도 같은 검사를 적용한다", () => {
    const r = held('<Button kind={"danger"} />', { mapping: { kind: "variant" }, props: ["variant", "kind"] });
    expect(r.held[0]?.detail).toContain('variant="danger"');
  });
});

describe("planComponentEdits: 속성 이름 충돌 (Imp3)", () => {
  it("이름을 바꾸면 같은 요소에 같은 속성이 둘이 될 때 mapping-conflict로 보류한다", () => {
    const code = `${BUTTON_IMPORT}export const A = () => <Button kind="x" variant="default" />;\n`;
    const r = run(code, [target({ mapping: { kind: "variant" } })]);
    expect(r.edits).toEqual([]);
    expect(r.held).toHaveLength(1);
    expect(r.held[0]).toMatchObject({ reason: "mapping-conflict", item: "Button" });
    expect(r.held[0]?.detail).toContain("kind");
    expect(r.held[0]?.detail).toContain("variant");
  });

  it("충돌하는 쪽도 함께 다른 이름으로 바뀌면 충돌이 아니다", () => {
    const code = `${BUTTON_IMPORT}export const A = () => <Button kind="x" variant="default" />;\n`;
    const r = run(code, [target({ mapping: { kind: "variant", variant: "tone" }, props: ["variant", "tone"] })]);
    expect(r.held).toEqual([]);
    expect(r.after).toContain('<Button variant="x" tone="default" />');
  });

  it("원래부터 중복인 속성은 이름을 바꾸지 않으면 충돌로 보지 않는다", () => {
    const code = `${BUTTON_IMPORT}export const A = () => <Button size="sm" size="md" />;\n`;
    expect(run(code, [target()]).held).toEqual([]);
  });
});

describe("planComponentEdits: JSX 태그가 아닌 사용 (Imp4)", () => {
  const nonJsx = (extra: string, imports = "") => {
    const code = `${BUTTON_IMPORT}${imports}${extra}\n`;
    return run(code, [target()]);
  };

  it.each([
    ["멤버 태그", "export const A = () => <Button.Group variant=\"zzz\" />;"],
    ["styled(Button)", "export const S = styled(Button)``;"],
    ["as={Button}", "export const A = () => <Box as={Button} variant=\"secondary\" />;"],
    ["createElement", "export const A = () => React.createElement(Button, { variant: \"secondary\" });"],
    ["값으로 전달", "export const map = { primary: Button };\nexport const b = Button;"],
    ["속성 값 표현식", "export const A = () => <Slot component={Button} />;"],
    ["typeof 참조", "export type P = React.ComponentProps<typeof Button>;"],
  ])("%s: non-jsx-use로 보류하고 줄 번호를 알린다", (_name, extra) => {
    const r = nonJsx(extra);
    expect(r.edits).toEqual([]);
    expect(r.held).toHaveLength(1);
    expect(r.held[0]).toMatchObject({ reason: "non-jsx-use", item: "Button", line: 2 });
    expect(r.held[0]?.detail).toContain("2줄");
  });

  it("일반 JSX 태그(여닫는 태그·속성 이름이 Button인 경우)는 그대로 바꾼다", () => {
    const r = nonJsx('export const A = () => <div data-Button="x"><Button size="sm">a</Button>{ {Button: 1}.Button }</div>;');
    expect(r.held).toEqual([]);
    expect(r.edits.length).toBeGreaterThan(0);
  });

  it("별칭으로 가져온 이름의 비태그 사용도 잡는다", () => {
    const code = 'import { Button as Btn } from "../src/components/Button";\nexport const S = styled(Btn)``;\nexport const A = () => <Btn />;\n';
    expect(run(code, [target()]).held[0]).toMatchObject({ reason: "non-jsx-use", line: 2 });
  });
});

describe("planComponentEdits: 별칭 import (M2)", () => {
  it("import { Button as Btn }를 계획하고 별칭을 유지한다", () => {
    const code = 'import { Button as Btn } from "../src/components/Button";\nexport const A = () => <Btn kind="primary" />;\n';
    const r = run(code, [target({ mapping: { kind: "variant" } })]);
    expect(r.after).toBe('import { Button as Btn } from "@/components/ui/button";\nexport const A = () => <Btn variant="primary" />;\n');
  });
});

describe("planComponentEdits: 접두사로 중복 주석 판단 (M3)", () => {
  it("specifier가 바뀌어도 같은 대상 파일의 주석이 있으면 다시 달지 않는다", () => {
    const local = target({ kind: "local-definition", module: "src/components/Badge", file: "src/components/Badge.tsx", options: ["src/components/Badge.tsx", "src/pages/Orders.tsx"], item: "Badge" });
    const code = '// dsmith: src/components/Badge.tsx로 통합됨 — 삭제 검토 (import { Badge } from "../components/Badge")\nfunction Badge() { return <i />; }\n';
    const r = run(code, [local], "src/pages/Orders.tsx");
    expect(r.edits).toEqual([]);
  });
});

describe("planComponentEdits: 상속 타입을 확인할 수 없는 대상 (Imp2)", () => {
  const cvaTarget = (p: Partial<ChosenTarget> = {}) =>
    target({ props: ["asChild"], inherits: ["React.ButtonHTMLAttributes<HTMLButtonElement>", "VariantProps<typeof buttonVariants>"], unknownInherits: ["VariantProps<typeof buttonVariants>"], ...p });

  it("확인할 수 없는 상속이 있으면 없는 prop은 한 번만 보류한다(상속 타입 확인 불가)", () => {
    const code = `${BUTTON_IMPORT}export const A = () => <><Button variant="outline" size="sm" /><Button variant="ghost" size="lg" /></>;\n`;
    const r = run(code, [cvaTarget()]);
    expect(r.edits).toEqual([]);
    expect(r.held).toHaveLength(1);
    expect(r.held[0]).toMatchObject({ reason: "mapping-missing" });
    expect(r.held[0]?.detail).toContain("상속 타입 확인 불가: VariantProps<typeof buttonVariants>");
    expect(r.held[0]?.detail.match(/상속 타입 확인 불가/g)).toHaveLength(1);
    expect(r.held[0]?.detail).toContain("variant");
    expect(r.held[0]?.detail).toContain("size");
  });

  it("mapping에 나온 prop(항등 포함)은 사용자가 확인한 것으로 보고 통과시킨다", () => {
    const code = `${BUTTON_IMPORT}export const A = () => <Button variant="outline" size="sm" onClick={f} />;\n`;
    expect(run(code, [cvaTarget({ mapping: { variant: "variant" } })]).held[0]?.detail).toContain("size");
    const both = run(code, [cvaTarget({ mapping: { variant: "variant", size: "size" } })]);
    expect(both.held).toEqual([]);
    expect(both.edits.some((e) => e.kind === "import")).toBe(true);
    // 값 매핑의 이름 부분도 확인으로 본다
    const byValue = run(code, [cvaTarget({ mapping: { "variant=outline": "variant=outline", size: "size" } })]);
    expect(byValue.held).toEqual([]);
  });

  it("상속을 모두 아는 대상에서는 mapping이 없는 prop을 통과시키지 않는다", () => {
    const code = `${BUTTON_IMPORT}export const A = () => <Button kind="x" />;\n`;
    const r = run(code, [target({ mapping: { kind: "tone" } })]);
    expect(r.held[0]?.detail).toContain("kind→tone");
  });
});
