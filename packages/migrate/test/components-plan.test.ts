import fs from "node:fs";
import path from "node:path";
import { chooseDecision, readIndex } from "@dsmith-dev/core";
import { describe, expect, it } from "vitest";
import { applyMigration, planMigration, revertMigration, type MigratePlan } from "../src/index.js";
import { SHADCN_BUTTON, TOKENS_CSS, auditFixture, loadState, makeRepo, read } from "./helpers.js";

const OLD = "src/components/Button.tsx";
const DS = "src/components/ui/button.tsx";

const oldButton = `import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "danger"; size?: "sm" | "md" };

export function Button({ kind = "primary", ...rest }: Props) {
  return <button {...rest} data-kind={kind} />;
}
`;
const dsButton = `import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive";
  size?: "sm" | "md";
}

export function Button({ variant = "default", ...rest }: ButtonProps) {
  return <button {...rest} data-variant={variant} />;
}
`;

function repo(extra: Record<string, string> = {}): string {
  return makeRepo({
    "package.json": JSON.stringify({ name: "x", dependencies: { react: "18", tailwindcss: "3.4.0" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    "styles/tokens.css": TOKENS_CSS,
    [OLD]: oldButton,
    [DS]: dsButton,
    "app/page.tsx": `import { Button } from "../src/components/Button";\n\nexport const P = () => (\n  <div>\n    <Button kind="primary" size="sm">a</Button>\n    <Button kind="danger" onClick={() => {}}>b</Button>\n  </div>\n);\n`,
    "app/ok.tsx": `import { Button } from "@/components/ui/button";\n\nexport const Q = () => <Button variant="destructive">x</Button>;\n`,
    ...extra,
  });
}

async function setup(root: string, mapping?: Record<string, string>, item = "Button", choose = "src/components/ui/button") {
  await auditFixture(root);
  const index = (await readIndex(root))!;
  await chooseDecision(root, index, item, choose, mapping === undefined ? {} : { mapping });
  const state = await loadState(root);
  return { state, plan: await planMigration({ root, ...state }) };
}

const MAP = { "kind=primary": "variant=default", "kind=danger": "variant=destructive" };

describe("planMigration: 컴포넌트 결정", () => {
  it("결정이 없으면 컴포넌트 계획은 비어 있고 토큰 계획은 그대로다", async () => {
    const root = repo();
    await auditFixture(root);
    const plan = await planMigration({ root, ...(await loadState(root)) });
    expect(plan.components).toEqual({ decided: 0, files: 0, imports: 0, props: 0, annotations: 0, pending: 1, held: { "decision-pending": 2 } });
    expect(plan.files).toEqual([]);
    expect(plan.componentPending).toEqual([{ item: "Button", kind: "duplicate", files: 2 }]);
  });

  it("props가 달라 mapping이 없으면 그 파일의 import는 보류하고 아무것도 바꾸지 않는다", async () => {
    const root = repo();
    const { plan } = await setup(root);
    expect(plan.files).toEqual([]);
    expect(plan.components).toMatchObject({ decided: 1, imports: 0, props: 0, held: { "mapping-missing": 1 } });
    expect(plan.componentHeld).toHaveLength(1);
    expect(plan.componentHeld[0]).toMatchObject({ item: "Button", file: "app/page.tsx", line: 1, reason: "mapping-missing" });
    expect(plan.componentHeld[0]?.detail).toContain("kind");
  });

  it("이름만 대응해도 대상이 허용하지 않는 값이면 보류하고 detail에 값을 적는다", async () => {
    const root = repo();
    const { plan } = await setup(root, { kind: "variant" });
    expect(plan.files).toEqual([]);
    expect(plan.components.held).toEqual({ "mapping-missing": 1 });
    expect(plan.componentHeld[0]?.detail).toContain('variant="primary"');
    expect(plan.componentHeld[0]?.detail).toContain('variant="danger"');
  });

  it("mapping을 주면 import와 prop 이름·값이 바뀌고 적용 뒤 재audit에서 중복이 사라진다", async () => {
    const root = repo();
    const { plan, state } = await setup(root, MAP);
    expect(plan.components).toMatchObject({ decided: 1, files: 1, imports: 1, props: 2, annotations: 0, pending: 0, held: {} });
    expect(plan.files.map((f) => f.file)).toEqual(["app/page.tsx"]);
    expect(plan.files[0]?.componentChecks).toEqual([{ item: "Button", module: "src/components/ui/button" }]);
    expect(plan.planned).toBe(0);

    const before = read(root, "app/page.tsx");
    const result = await applyMigration(root, plan, { extractors: state.extractors, version: "t" });
    expect(result).toMatchObject({ replaced: 0, components: 1, props: 2, annotations: 0, componentsRolledBack: 0 });
    const after = read(root, "app/page.tsx");
    expect(after).toBe(
      `import { Button } from "@/components/ui/button";\n\nexport const P = () => (\n  <div>\n    <Button variant="default" size="sm">a</Button>\n    <Button variant="destructive" onClick={() => {}}>b</Button>\n  </div>\n);\n`,
    );
    expect(after).not.toBe(before);

    // 재audit: Button 사용처가 모두 DS module
    await auditFixture(root);
    const index = (await readIndex(root))!;
    const modules = new Set(index.components.filter((c) => c.name === "Button").map((c) => c.module));
    expect([...modules]).toEqual(["src/components/ui/button"]);
    // 정의는 지우지 않는다
    expect(fs.existsSync(path.join(root, OLD))).toBe(true);
  });

  it("되돌리면 원문이 돌아온다", async () => {
    const root = repo();
    const { plan, state } = await setup(root, MAP);
    const before = read(root, "app/page.tsx");
    const result = await applyMigration(root, plan, { extractors: state.extractors, version: "t" });
    expect(read(root, "app/page.tsx")).not.toBe(before);
    await revertMigration(root, result.id);
    expect(read(root, "app/page.tsx")).toBe(before);
  });

  it("두 번째 계획은 비어 있다(멱등)", async () => {
    const root = repo();
    const { plan, state } = await setup(root, MAP);
    await applyMigration(root, plan, { extractors: state.extractors, version: "t" });
    await auditFixture(root);
    const again = await planMigration({ root, ...(await loadState(root)) });
    expect(again.files).toEqual([]);
    expect(again.components).toMatchObject({ decided: 1, imports: 0, props: 0, held: {} });
  });

  it("--only tokens는 컴포넌트를 건드리지 않고, --only components는 토큰 치환을 범위 밖으로 둔다", async () => {
    const root = repo({ "src/a.css": ".a { color: #3b82f6; padding: 16px; }\n" });
    const { state } = await setup(root, MAP);
    const tokens = await planMigration({ root, ...state, only: "tokens" });
    expect(tokens.components).toMatchObject({ decided: 0, imports: 0, pending: 0 });
    expect(tokens.planned).toBeGreaterThan(0);
    expect(tokens.files.every((f) => f.components.length === 0)).toBe(true);

    const comps = await planMigration({ root, ...state, only: "components" });
    expect(comps.planned).toBe(0);
    expect(comps.scope.outOfRange).toBe(tokens.planned);
    expect(comps.components.imports).toBe(1);
    expectInvariants(comps);

    const both = await planMigration({ root, ...state });
    expect(both.planned).toBe(tokens.planned);
    expect(both.components.imports).toBe(1);
    expectInvariants(both);
  });

  it("토큰 치환과 컴포넌트 prop 편집이 같은 구간이면 양쪽 모두 보류한다(overlap)", async () => {
    const root = repo({
      "app/page.tsx": `import { Button } from "../src/components/Button";\n\nexport const P = () => <Button kind="primary" className="p-[16px]">a</Button>;\n`,
    });
    const mapping = { "kind=primary": "variant=default", "className=p-[16px]": "className=ds-pad" };
    const { plan } = await setup(root, mapping);
    expect(plan.files.find((f) => f.file === "app/page.tsx")).toBeUndefined();
    expect(plan.components.held).toEqual({ overlap: 1 });
    expect(plan.skipped.overlap).toBe(1);
    expectInvariants(plan);
  });

  it("지정자가 여럿이면 그 항목만 옮기고 같은 module의 기존 import에는 합친다", async () => {
    const root = repo({
      "app/page.tsx": `import { Card } from "@/components/ui/card";\nimport { Button, Label } from "../src/components/Button";\nimport { Dialog } from "@/components/ui/button";\n\nexport const P = () => <Button kind="primary">a</Button>;\n`,
      "src/components/ui/card.tsx": "export const Card = () => null;\n",
    });
    const { plan, state } = await setup(root, MAP);
    await applyMigration(root, plan, { extractors: state.extractors, version: "t" });
    expect(read(root, "app/page.tsx")).toBe(
      `import { Card } from "@/components/ui/card";\nimport { Label } from "../src/components/Button";\nimport { Dialog, Button } from "@/components/ui/button";\n\nexport const P = () => <Button variant="default">a</Button>;\n`,
    );
  });

  it("local-definition은 선언 위에 주석만 붙이고 정의를 지우지 않는다", async () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ name: "x", dependencies: { react: "18" } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
      "styles/tokens.css": TOKENS_CSS,
      "src/components/Badge.tsx": `export function Badge({ children }: { children: string }) {\n  return <i>{children}</i>;\n}\nexport const U = () => <Badge>u</Badge>;\n`,
      "src/pages/Orders.tsx": `function Badge({ children }: { children: string }) {\n  return <b>{children}</b>;\n}\nexport const O = () => <Badge>o</Badge>;\n`,
    });
    await auditFixture(root);
    const index = (await readIndex(root))!;
    await chooseDecision(root, index, "Badge", "src/components/Badge.tsx", { kind: "local-definition" });
    const state = await loadState(root);
    const plan = await planMigration({ root, ...state });
    expect(plan.components).toMatchObject({ decided: 1, files: 1, imports: 0, props: 0, annotations: 1 });
    await applyMigration(root, plan, { extractors: state.extractors, version: "t" });
    expect(read(root, "src/pages/Orders.tsx")).toBe(
      `// dsmith: src/components/Badge.tsx로 통합됨 — 삭제 검토 (import { Badge } from "@/components/Badge")\nfunction Badge({ children }: { children: string }) {\n  return <b>{children}</b>;\n}\nexport const O = () => <Badge>o</Badge>;\n`,
    );
    expect(read(root, "src/components/Badge.tsx")).toContain("export function Badge");
    // 두 번째 계획에는 주석이 없다
    await auditFixture(root);
    const again = await planMigration({ root, ...(await loadState(root)) });
    expect(again.components.annotations).toBe(0);
  });
});

function expectInvariants(p: MigratePlan): void {
  const skipped = Object.values(p.skipped).reduce((n, v) => n + (v ?? 0), 0);
  expect(p.planned + skipped + p.scope.outOfRange).toBe(p.scope.candidates);
}

describe("planMigration: shadcn/cva 스타일 대상 (Imp2)", () => {
  const legacy = `import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string };

export function Button(props: Props) {
  return <button {...props} />;
}
`;
  const page = (attrs: string) => `import { Button } from "../src/components/Button";\n\nexport const P = () => <Button ${attrs}>a</Button>;\n`;
  const shadcnRepo = (attrs: string, ds = SHADCN_BUTTON, extra: Record<string, string> = {}) =>
    repo({ [OLD]: legacy, [DS]: ds, "app/page.tsx": page(attrs), "app/ok.tsx": `import { Button } from "@/components/ui/button";\nexport const Q = () => <Button variant="outline" />;\n`, ...extra });

  it("VariantProps<typeof buttonVariants>를 같은 파일의 cva variants 키로 풀어 mapping 없이 통과시킨다", async () => {
    const root = shadcnRepo('variant="outline" size="sm" onClick={f} asChild');
    const { plan, state } = await setup(root);
    expect(plan.componentHeld).toEqual([]);
    expect(plan.components).toMatchObject({ imports: 1, props: 0, held: {} });
    await applyMigration(root, plan, { extractors: state.extractors, version: "t" });
    expect(read(root, "app/page.tsx")).toContain('import { Button } from "@/components/ui/button";');
    await auditFixture(root);
    const index = (await readIndex(root))!;
    expect([...new Set(index.components.filter((c) => c.name === "Button").map((c) => c.module))]).toEqual(["src/components/ui/button"]);
  });

  it("cva 키에 없는 값은 허용 값 검사로 보류하고 따옴표 키 값은 허용한다", async () => {
    const bad = await setup(shadcnRepo('variant="secondary"'));
    expect(bad.plan.componentHeld[0]).toMatchObject({ reason: "mapping-missing" });
    expect(bad.plan.componentHeld[0]?.detail).toContain('variant="secondary"');
    const quoted = await setup(shadcnRepo('variant="ghost-soft"'));
    expect(quoted.plan.componentHeld).toEqual([]);
    const expr = await setup(shadcnRepo('variant={d ? "outline" : "nope"}'));
    expect(expr.plan.componentHeld[0]?.detail).toContain('variant="nope"');
  });

  it("cva 정의를 찾을 수 없으면 한 번 보류하고, 항등 mapping(--map variant:variant)으로 풀린다", async () => {
    const unresolved = SHADCN_BUTTON.replace(/const buttonVariants = cva[\s\S]*?\n\}\);\n/, 'import { buttonVariants } from "./variants";\n');
    expect(unresolved).not.toBe(SHADCN_BUTTON);
    const held = await setup(shadcnRepo('variant="outline" size="sm"', unresolved));
    expect(held.plan.files).toEqual([]);
    expect(held.plan.componentHeld).toHaveLength(1);
    expect(held.plan.componentHeld[0]).toMatchObject({ reason: "mapping-missing" });
    expect(held.plan.componentHeld[0]?.detail).toContain("상속 타입 확인 불가: VariantProps<typeof buttonVariants>");

    const root = shadcnRepo('variant="outline" size="sm"', unresolved);
    const cleared = await setup(root, { variant: "variant", size: "size" });
    expect(cleared.plan.componentHeld).toEqual([]);
    expect(cleared.plan.components).toMatchObject({ imports: 1, props: 0 });
    await applyMigration(root, cleared.plan, { extractors: cleared.state.extractors, version: "t" });
    expect(read(root, "app/page.tsx")).toBe(`import { Button } from "@/components/ui/button";\n\nexport const P = () => <Button variant="outline" size="sm">a</Button>;\n`);
  });

  it("교차 타입(ComponentProps<\"button\"> & VariantProps<…>) 파라미터도 푼다", async () => {
    const intersection = SHADCN_BUTTON.replace(/export interface ButtonProps[\s\S]*?\n\}\n\n/, "").replace(
      "}: ButtonProps)",
      '}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean })',
    );
    expect(intersection).toContain("& VariantProps<typeof buttonVariants>");
    const { plan } = await setup(shadcnRepo('variant="destructive" size="lg"', intersection));
    expect(plan.componentHeld).toEqual([]);
    expect(plan.components.imports).toBe(1);
  });
});

describe("planMigration: 멤버 태그만 쓰는 파일 (Imp4)", () => {
  it("<Button.Group>만 쓰는 파일도 non-jsx-use로 보류하고 import는 그대로 둔다", async () => {
    const root = repo({
      "app/group.tsx": `import { Button } from "../src/components/Button";\n\nexport const G = () => <Button.Group variant="zzz" />;\n`,
    });
    const { plan } = await setup(root, MAP);
    expect(plan.componentHeld.find((h) => h.file === "app/group.tsx")).toMatchObject({ reason: "non-jsx-use", line: 3 });
    expect(plan.files.map((f) => f.file)).toEqual(["app/page.tsx"]);
  });
});

describe("planMigration: 네임스페이스 import (M6)", () => {
  it("named import와 `import * as L` + <L.Button>을 함께 쓰는 파일은 계획 단계에서 non-jsx-use로 보류한다(rolled-back이 아니다)", async () => {
    const root = repo({
      "app/mixed.tsx": `import { Button } from "../src/components/Button";\nimport * as Legacy from "../src/components/Button";\n\nexport const M = () => (\n  <div>\n    <Button kind="primary">a</Button>\n    <Legacy.Button kind="danger">b</Legacy.Button>\n  </div>\n);\n`,
    });
    const { plan } = await setup(root, MAP);
    const held = plan.componentHeld.find((h) => h.file === "app/mixed.tsx");
    expect(held).toMatchObject({ item: "Button", reason: "non-jsx-use" });
    expect(held?.detail).toContain("Legacy.Button");
    expect(plan.components.held["rolled-back"]).toBeUndefined();
    expect(plan.files.map((f) => f.file)).toEqual(["app/page.tsx"]);
  });

  it("네임스페이스로만 쓰는 파일도 보류로 알린다", async () => {
    const root = repo({
      "app/ns.tsx": `import * as Legacy from "../src/components/Button";\n\nexport const N = () => <Legacy.Button kind="primary">a</Legacy.Button>;\n`,
    });
    const { plan } = await setup(root, MAP);
    expect(plan.componentHeld.find((h) => h.file === "app/ns.tsx")).toMatchObject({ reason: "non-jsx-use", line: 1 });
    expect(plan.files.map((f) => f.file)).toEqual(["app/page.tsx"]);
  });

  it("다른 멤버(<Legacy.Card>)만 쓰는 네임스페이스는 이 항목과 상관없어 보류하지 않는다", async () => {
    const root = repo({
      "app/other.tsx": `import { Button } from "../src/components/Button";\nimport * as Legacy from "../src/components/Button";\n\nexport const O = () => (\n  <div>\n    <Button kind="primary">a</Button>\n    <Legacy.Card />\n  </div>\n);\n`,
    });
    const { plan } = await setup(root, MAP);
    expect(plan.componentHeld.find((h) => h.file === "app/other.tsx")).toBeUndefined();
    expect(plan.files.map((f) => f.file)).toContain("app/other.tsx");
  });
});

describe("planMigration: 별칭 import (M2)", () => {
  it("import { Button as LegacyButton } 파일도 계획·적용하고 별칭을 유지한다", async () => {
    // 결정 항목(Button)은 별칭 없이 쓰는 app/page.tsx 덕에 생기고, 별칭 파일도 같은 항목으로 계획된다
    const root = repo({
      "app/alias.tsx": `import { Button as LegacyButton } from "../src/components/Button";\n\nexport const P = () => <LegacyButton kind="primary">a</LegacyButton>;\n`,
    });
    const { plan, state } = await setup(root, MAP);
    expect(plan.files.map((f) => f.file).sort()).toEqual(["app/alias.tsx", "app/page.tsx"]);
    await applyMigration(root, plan, { extractors: state.extractors, version: "t" });
    expect(read(root, "app/alias.tsx")).toContain('import { Button as LegacyButton } from "@/components/ui/button";');
    expect(read(root, "app/alias.tsx")).toContain('<LegacyButton variant="default">a</LegacyButton>');
    await auditFixture(root);
    const index = (await readIndex(root))!;
    const modules = index.components.filter((c) => (c.imported ?? c.name) === "Button").map((c) => c.module);
    expect(new Set(modules)).toEqual(new Set(["src/components/ui/button"]));
  });
});
