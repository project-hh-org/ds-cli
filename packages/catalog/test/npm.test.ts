import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog, catalogFromPackage, componentsFromDts, resolvePackageTypes } from "../src/index.js";
import { auditFixture, copyFixture, installMui, tmpTree } from "./helpers.js";

describe.each([
  ["6.5.0", "mui-material-6" as const, "index.d.ts", "Button/Button.d.ts"],
  ["9.5.0", "mui-material-9" as const, "index.d.mts", "Button/Button.d.mts"],
])("npm DS: @mui/material %s (fixtures/mui-app)", (version, fixture, entry, declFile) => {
  it("타입 엔트리를 exports/types로 푼다", async () => {
    const root = copyFixture("mui-app");
    installMui(root, fixture);
    const types = await resolvePackageTypes(root, "@mui/material");
    expect(types?.entryRel).toBe(`node_modules/@mui/material/${entry}`);
    expect(types?.version).toBe(version);
  });

  it("Button·Select·TextField: variant·size·color values, file, module", async () => {
    const root = copyFixture("mui-app");
    installMui(root, fixture);
    const { index } = await auditFixture(root);
    const { components, source, warnings } = await catalogFromPackage(root, "@mui/material", index);
    expect(warnings).toEqual([]);
    expect(source).toMatchObject({ origin: "ds-npm", packageName: "@mui/material", packageVersion: version });
    expect(components.map((c) => c.name)).toEqual(["Button", "Select", "TextField"]);
    const button = components.find((c) => c.name === "Button");
    expect(button?.module).toBe("@mui/material");
    expect(button?.origin).toBe("ds-npm");
    expect(button?.file).toBe(`node_modules/@mui/material/${declFile}`);
    const prop = (n: string) => button?.props.find((p) => p.name === n);
    expect(prop("variant")?.values).toEqual(["text", "outlined", "contained"]);
    expect(prop("size")?.values).toEqual(["small", "medium", "large"]);
    expect(prop("color")?.values).toEqual(["inherit", "primary", "secondary", "success", "error", "info", "warning"]);
    expect(prop("disabled")?.default).toBe("false");
    expect(prop("variant")?.required).toBe(false);
    expect(button?.propsStatus).toBe("ok");
    expect(button?.props.length).toBeGreaterThanOrEqual(15);
    expect(button?.description).toBeUndefined();
    expect(button?.inherits).toEqual(["ButtonBaseOwnProps", "RootComponent HTML attributes"]);
  });

  it("실제 TextField(제네릭 함수 + 조건부 타입)는 25개 이상의 props와 variant values를 낸다", async () => {
    const root = copyFixture("mui-app");
    installMui(root, fixture);
    const { index } = await auditFixture(root);
    const { components } = await catalogFromPackage(root, "@mui/material", index);
    const tf = components.find((c) => c.name === "TextField");
    expect(tf?.props.length).toBeGreaterThanOrEqual(25);
    expect([...(tf?.props.find((p) => p.name === "variant")?.values ?? [])].sort()).toEqual(["filled", "outlined", "standard"]);
    expect(tf?.props.find((p) => p.name === "size")?.values).toEqual(["small", "medium"]);
    expect(tf?.props.find((p) => p.name === "label")).toBeDefined();
    expect(tf?.inherits?.some((i) => i.startsWith("StandardProps<"))).toBe(true);
    expect(tf?.inherits?.every((i) => i.length <= 100 && !i.includes("/*"))).toBe(true);
    expect(tf?.inherits?.some((i) => i.includes("TextFieldProps"))).toBe(false);
    console.info(`[real-pack] ${version} TextField props=${tf?.props.length}`);
  });

  it("실제 Select(함수 타입 & 객체 교차, 제네릭 유니온 별칭)는 20개 이상 + variant values", async () => {
    const root = copyFixture("mui-app");
    installMui(root, fixture);
    const { index } = await auditFixture(root);
    const { components } = await catalogFromPackage(root, "@mui/material", index);
    const sel = components.find((c) => c.name === "Select");
    expect(sel?.props.length).toBeGreaterThanOrEqual(20);
    expect([...(sel?.props.find((p) => p.name === "variant")?.values ?? [])].sort()).toEqual(["filled", "outlined", "standard"]);
    expect(sel?.propsStatus).toBe("ok");
  });

  it("buildCatalog(detect.ds npm)로도 같은 컴포넌트", async () => {
    const root = copyFixture("mui-app");
    installMui(root, fixture);
    const { index, detect } = await auditFixture(root);
    expect(detect.ds.kind).toBe("npm");
    const { catalog } = await buildCatalog({ root, detect, index, version: "x" });
    expect(catalog.components.map((c) => c.name)).toEqual(["Button", "Select", "TextField"]);
    expect(catalog.stats).toMatchObject({ components: 3, propsOk: 3 });
  });
});

describe("npm DS: 없음·경계", () => {
  it("node_modules 없음 → components [] + 경고", async () => {
    const root = copyFixture("mui-app");
    const { index } = await auditFixture(root);
    const r = await catalogFromPackage(root, "@mui/material", index);
    expect(r.components).toEqual([]);
    expect(r.warnings).toEqual(["node_modules/@mui/material 없음 — 의존성 설치 후 다시 실행"]);
  });
});

describe("componentsFromDts", () => {
  it("순환 re-export(a → b → a)는 무한루프 없이 경고", async () => {
    const root = tmpTree({
      "a.d.ts": "export { default as Foo } from './b';\nexport { Bar } from './b';\n",
      "b.d.ts": "export { default } from './a';\nexport { Bar } from './a';\n",
    });
    const r = await componentsFromDts(path.join(root, "a.d.ts"));
    expect(r.components).toEqual([]);
    expect(r.warnings.some((w) => w.includes("순환"))).toBe(true);
  });

  it("4홉 체인은 maxHops 3에서 멈추고 경고", async () => {
    const files = {
      "index.d.ts": "export { default as Deep } from './h1';\n",
      "h1.d.ts": "export { default } from './h2';\n",
      "h2.d.ts": "export { default } from './h3';\n",
      "h3.d.ts": "export { default } from './h4';\n",
      "h4.d.ts": "declare function Deep(p: { a?: string }): null;\nexport default Deep;\n",
    };
    const root = tmpTree(files);
    const r = await componentsFromDts(path.join(root, "index.d.ts"));
    expect(r.components).toEqual([]);
    expect(r.warnings.some((w) => w.includes("3홉"))).toBe(true);
    const ok = await componentsFromDts(path.join(root, "index.d.ts"), { maxHops: 4 });
    expect(ok.components.map((c) => c.name)).toEqual(["Deep"]);
    expect(ok.components[0]?.props?.props.map((p) => p.name)).toEqual(["a"]);
  });

  it("함수·클래스·XProps·TypeMap 선언과 export * 1단계", async () => {
    const root = tmpTree({
      "index.d.ts": "export * from './all';\nexport { default as Card } from './Card.js';\nexport { default as Legacy } from './Legacy.mjs';\n",
      "all.d.ts": `export declare function Tag(props: TagProps): null;
export interface TagProps { /** 라벨 */ label: string; kind?: 'a' | 'b' }
export declare class Panel extends React.Component<{ open?: boolean }> {}
export declare const SIZES: string;
export declare const Wrapped: React.FC<{ x?: number }>;
`,
      "Card.d.ts": `declare const Card: ExtendBase<CardTypeMap>;
export type CardTypeMap<A = {}> = ExtendBaseTypeMap<{ props: A & CardOwn & { raised?: boolean }; defaultComponent: 'div' }>;
interface CardOwn { /** @deprecated 쓰지 마세요 */ flat?: boolean }
export default Card;
`,
      "Legacy.d.mts": "/** 오래된 것 */\ndeclare function Legacy(): null;\nexport default Legacy;\n",
    });
    const r = await componentsFromDts(path.join(root, "index.d.ts"));
    const by = Object.fromEntries(r.components.map((c) => [c.name, c]));
    expect(Object.keys(by).sort()).toEqual(["Card", "Legacy", "Panel", "Tag", "Wrapped"]);
    expect(by.Tag?.props?.props.map((p) => p.name)).toEqual(["label", "kind"]);
    expect(by.Tag?.props?.props[1]?.values).toEqual(["a", "b"]);
    expect(by.Panel?.props?.props.map((p) => p.name)).toEqual(["open"]);
    expect(by.Wrapped?.props?.props.map((p) => p.name)).toEqual(["x"]);
    expect(by.Card?.props?.props.map((p) => p.name)).toEqual(["flat", "raised"]);
    expect(by.Card?.props?.props[0]?.deprecated).toBe("쓰지 마세요");
    expect(by.Legacy?.doc?.description).toBe("오래된 것");
    expect(by.Legacy?.props).toBeNull();
  });

  it("interface XTypeMap { props } 형태와 함수 타입 & 객체 교차(declare const)를 읽는다", async () => {
    const root = tmpTree({
      "index.d.ts": "export { default as Panel } from './Panel';\nexport { default as Pick } from './Pick';\n",
      "Panel.d.ts": `declare const Panel: Ext<PanelTypeMap>;
export interface PanelTypeMap { props: PanelBase & { dense?: boolean }; defaultComponent: 'div' }
interface PanelBase { open?: boolean }
export default Panel;
`,
      "Pick.d.ts": `export interface PickBase<V = unknown> { value?: V; kind?: 'a' | 'b' }
export type PickProps<V = unknown> = PickBase<V> & { extra?: string };
declare const Pick: (<V = unknown>(props: PickProps<V>) => null) & { muiName: string };
export default Pick;
`,
    });
    const r = await componentsFromDts(path.join(root, "index.d.ts"));
    const by = Object.fromEntries(r.components.map((c) => [c.name, c]));
    expect(by.Panel?.props?.props.map((p) => p.name).sort()).toEqual(["dense", "open"]);
    expect(by.Pick?.props?.props.map((p) => p.name).sort()).toEqual(["extra", "kind", "value"]);
    expect(by.Pick?.props?.props.find((p) => p.name === "kind")?.values).toEqual(["a", "b"]);
  });

  it("props를 못 읽은 npm 컴포넌트는 경고 한 줄로 모은다", async () => {
    const root = tmpTree({
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", types: "index.d.ts" }),
      "node_modules/pkg/index.d.ts": "export declare function A(): null;\nexport declare function B(): null;\nexport declare function C(p: { x?: 1 }): null;\n",
    });
    const { index } = await auditFixture(copyFixture("mui-app"));
    const r = await catalogFromPackage(root, "pkg", index);
    expect(r.warnings).toEqual(["props 미추출 2: A, B"]);
  });

  it("패키지 밖으로 나가는 지정자는 무시한다", async () => {
    const root = tmpTree({
      "pkg/index.d.ts": "export { default as Out } from '../outside';\n",
      "outside.d.ts": "declare function Out(): null;\nexport default Out;\n",
    });
    const r = await componentsFromDts(path.join(root, "pkg", "index.d.ts"));
    expect(r.components).toEqual([]);
  });
});
