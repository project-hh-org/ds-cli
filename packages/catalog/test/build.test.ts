import path from "node:path";
import { moduleOfFile, resolveDefinitionFile } from "@dsmith-dev/core";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../src/index.js";
import { BADGE as BADGE_SRC, auditFixture, copyFixture, overlay } from "./helpers.js";

const dtcg = (): string => {
  const color = (name: string, rgb: number[], hex: string) => [name, { $value: { colorSpace: "srgb", components: rgb, hex } }];
  const dim = (name: string, value: number) => [name, { $value: { value, unit: "px" } }];
  return JSON.stringify({
    color: { $type: "color", ...Object.fromEntries([color("primary", [0.2, 0.4, 0.9], "#3366e6"), color("text", [0, 0, 0], "#000000"), color("bg", [1, 1, 1], "#ffffff"), color("muted", [0.5, 0.5, 0.5], "#808080"), color("danger", [0.9, 0.1, 0.1], "#e61a1a"), color("ok", [0.1, 0.8, 0.2], "#1acc33")]) },
    spacing: { $type: "dimension", ...Object.fromEntries([dim("1", 4), dim("2", 8), dim("3", 12), dim("4", 16)]) },
    radius: { $type: "dimension", ...Object.fromEntries([dim("sm", 4), dim("md", 8)]) },
    text: { $type: "dimension", ...Object.fromEntries([dim("sm", 12), dim("md", 14)]) },
  });
};
const INIT_MANIFEST = JSON.stringify({ version: 1, tool: "init", dsmith: "x", entries: { "design-system/tokens.json": { sha256: "0" } } });


describe("buildCatalog: 로컬 DS (fixtures/with-ds-app)", () => {
  it("컴포넌트·props·예제·deprecated·stats", async () => {
    const root = copyFixture("with-ds-app", overlay);
    const { index, detect } = await auditFixture(root);
    const { catalog } = await buildCatalog({ root, detect, index, version: "0.0.0-test" });

    expect(catalog.sources).toEqual([{ origin: "ds-local", dir: "components/ui" }]);
    expect(catalog.components.map((c) => c.name)).toEqual(["Badge", "Button", "OldButton"]);

    const button = catalog.components.find((c) => c.name === "Button");
    expect(button?.module).toBe("components/ui/Button");
    expect(button?.origin).toBe("ds-local");
    expect(button?.props).toEqual([{ name: "children", type: "ReactNode", required: true }]);
    expect(button?.examples?.[0]?.code.startsWith("export const Primary")).toBe(true);
    expect(button?.examples?.[0]?.file).toBe("components/ui/Button.stories.tsx");

    const badge = catalog.components.find((c) => c.name === "Badge");
    expect(badge?.props.find((p) => p.name === "tone")?.values).toEqual(["neutral", "danger"]);
    expect(badge?.description).toBe("상태 배지.");

    const old = catalog.components.find((c) => c.name === "OldButton");
    expect(old?.deprecated).toBe("Button을 쓰세요");
    expect(old?.propsStatus).toBe("none");

    expect(catalog.stats).toMatchObject({ components: 3, propsOk: 2, deprecated: 1 });
    expect(catalog.dsmith).toBe("0.0.0-test");
  });

  it("모든 module이 resolveDefinitionFile로 원 파일에 돌아가고 moduleOfFile 왕복이 맞는다", async () => {
    const root = copyFixture("with-ds-app", overlay);
    const { index, detect } = await auditFixture(root);
    const { catalog } = await buildCatalog({ root, detect, index, version: "0.0.0-test" });
    for (const c of catalog.components) {
      expect(await resolveDefinitionFile(root, c.module)).toBe(c.file);
      expect(moduleOfFile(c.file as string)).toBe(c.module);
    }
    // 인덱스 사용 수 조인 키: Button 사용은 이 module을 가리킨다
    const usedModules = new Set(index.components.map((u) => u.module));
    expect(usedModules.has("components/ui/Button")).toBe(true);
  });

  it("두 번 만들면 JSON이 동일하다(타임스탬프·절대 경로 없음)", async () => {
    const root = copyFixture("with-ds-app", overlay);
    const { index, detect } = await auditFixture(root);
    const a = JSON.stringify((await buildCatalog({ root, detect, index, version: "x" })).catalog);
    const b = JSON.stringify((await buildCatalog({ root, detect, index, version: "x" })).catalog);
    expect(a).toBe(b);
    expect(a).not.toContain(path.dirname(root));
  });

  it("같은 이름이 여러 파일에 있으면 경로 순 첫 파일만, 경고 1줄", async () => {
    const root = copyFixture("with-ds-app", {
      "components/ui/a/Dup.tsx": "export function Dup() { return null; }\n",
      "components/ui/b/Dup.tsx": "export function Dup() { return null; }\n",
    });
    const { index, detect } = await auditFixture(root);
    const { catalog, warnings } = await buildCatalog({ root, detect, index, version: "x" });
    expect(catalog.components.filter((c) => c.name === "Dup").map((c) => c.file)).toEqual(["components/ui/a/Dup.tsx"]);
    expect(warnings.filter((w) => w.includes("Dup"))).toHaveLength(1);
  });

  it("export { X, Y as Z }·export default X·ALL_CAPS 상수 제외·Props 제외", async () => {
    const root = copyFixture("with-ds-app", {
      "components/ui/Multi.tsx": `function Card() { return null; }
const Chip = () => null;
const SIZES = { a: 1 };
export const MAX_SIZE = 3;
export type CardProps = {};
export { Card, Chip as SmallChip, SIZES };
export default Card;
`,
    });
    const { index, detect } = await auditFixture(root);
    const { catalog } = await buildCatalog({ root, detect, index, version: "x" });
    const names = catalog.components.filter((c) => c.file === "components/ui/Multi.tsx").map((c) => c.name);
    expect(names).toEqual(["Card", "SmallChip"]);
  });

  it("ds none + init 없음 → Error, from init인데 init 없음 → 빈 결과 + 경고", async () => {
    const root = copyFixture("with-ds-app");
    const { index, detect } = await auditFixture(root);
    const none = { ...detect, ds: { kind: "none" as const, tokenFiles: [] } };
    await expect(buildCatalog({ root, detect: none, index, version: "x" })).rejects.toThrow(
      "DS를 찾지 못함: detect.ds가 none이고 init 산출도 없음 — 먼저 `dsmith init`",
    );
    const r = await buildCatalog({ root, detect, index, version: "x", from: "init" });
    expect(r.catalog.components).toEqual([]);
    expect(r.warnings.some((w) => w.includes("init"))).toBe(true);
  });

  it("init 산출 디렉터리(.dsmith/init.json 키)를 두 번째 소스로 읽고 정렬은 init이 뒤", async () => {
    const root = copyFixture("with-ds-app", {
      ".dsmith/init.json": JSON.stringify({ version: 1, tool: "init", dsmith: "x", entries: { "ds-out/tokens.json": { sha256: "0" } } }),
      "ds-out/tokens.json": "{}",
      "ds-out/components/Alert.tsx": "export function Alert({ tone }: { tone?: 'info' | 'error' }) { return null; }\n",
    });
    const { index, detect } = await auditFixture(root);
    const { catalog } = await buildCatalog({ root, detect, index, version: "x" });
    expect(catalog.sources.map((s) => s.origin)).toEqual(["ds-local", "init"]);
    expect(catalog.components.map((c) => `${c.origin}:${c.name}`)).toEqual(["ds-local:Button", "init:Alert"]);
    const alert = catalog.components.find((c) => c.name === "Alert");
    expect(alert?.module).toBe("ds-out/components/Alert");
    expect(alert?.props[0]?.values).toEqual(["info", "error"]);
  });

  it("DTCG tokens.json만 있으면 토큰 14개, file은 design-system/tokens.json", async () => {
    const root = copyFixture("with-ds-app", { ".dsmith/init.json": INIT_MANIFEST, "design-system/tokens.json": dtcg() });
    const { index, detect } = await auditFixture(root);
    const { catalog } = await buildCatalog({ root, detect, index, version: "x" });
    expect(catalog.tokens).toHaveLength(14);
    expect(catalog.tokens.every((t) => t.file === "design-system/tokens.json")).toBe(true);
    expect(catalog.stats.tokens).toBe(14);
    expect(new Set(catalog.tokens.map((t) => t.category))).toEqual(new Set(["color", "spacing", "radius", "font-size"]));
  });

  it("CSS와 JSON에 같은 토큰이 있으면 CSS가 이기고 file은 css", async () => {
    const root = copyFixture("with-ds-app", {
      "styles/tokens.css": ":root {\n  --color-primary: #112233;\n}\n",
      ".dsmith/init.json": INIT_MANIFEST,
      "design-system/tokens.json": dtcg(),
    });
    const { index, detect } = await auditFixture(root);
    const { catalog } = await buildCatalog({ root, detect, index, version: "x" });
    const css = catalog.tokens.filter((t) => t.file === "styles/tokens.css");
    expect(css.map((t) => t.name)).toEqual(["--color-primary"]);
    expect(catalog.tokens.some((t) => t.file === "design-system/tokens.json")).toBe(true);
    expect(catalog.stats.tokens).toBe(catalog.tokens.length);
  });

  it("읽지 않는 토큰 파일(theme.ts)은 경고로 알린다", async () => {
    const root = copyFixture("with-ds-app", { "src/theme.ts": "export const theme = {};\n" });
    const { index, detect } = await auditFixture(root);
    const { warnings } = await buildCatalog({ root, detect, index, version: "x" });
    expect(warnings).toContain("토큰 파일 형식을 읽지 않음(건너뜀): src/theme.ts");
  });

  it("배럴 index.ts가 re-export하는 컴포넌트는 modules에 배럴 module을 포함한다", async () => {
    const root = copyFixture("with-ds-app", {
      "components/ui/index.ts": "export { Button } from './Button';\nexport * from './Badge';\nexport { OldButton as Legacy } from './OldButton';\n",
      "components/ui/Badge.tsx": BADGE_SRC,
      "src/pages/UsesBarrel.tsx": "import { Button } from '../../components/ui';\nexport const P = () => <Button>x</Button>;\n",
    });
    const { index, detect } = await auditFixture(root);
    const { catalog } = await buildCatalog({ root, detect, index, version: "x" });
    const by = Object.fromEntries(catalog.components.map((c) => [c.name, c]));
    expect(by.Button?.modules).toEqual(["components/ui/Button", "components/ui"]);
    expect(by.Badge?.modules).toEqual(["components/ui/Badge", "components/ui"]);
    expect(by.OldButton?.modules).toBeUndefined();
    const used = index.components.filter((u) => u.name === "Button").map((u) => u.module);
    expect(used).toContain("components/ui");
    expect(by.Button?.modules?.some((m) => used.includes(m))).toBe(true);
  });

  it("짧은 이름(H1)은 컴포넌트, 객체 const·일반 클래스·상수는 아니다", async () => {
    const root = copyFixture("with-ds-app", {
      "components/ui/Misc.tsx": `export const H1 = () => null;
export const VARIANTS = { a: 1 };
export const Sizes = ["s", "m"];
export const Label = "x";
export class Helper {}
export class Boxed extends React.Component {}
`,
    });
    const { index, detect } = await auditFixture(root);
    const { catalog } = await buildCatalog({ root, detect, index, version: "x" });
    expect(catalog.components.filter((c) => c.file === "components/ui/Misc.tsx").map((c) => c.name)).toEqual(["Boxed", "H1"]);
  });
});
