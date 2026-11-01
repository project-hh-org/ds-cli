import path from "node:path";
import { moduleOfFile, resolveDefinitionFile } from "@dsmith-dev/core";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../src/index.js";
import { auditFixture, copyFixture, overlay } from "./helpers.js";


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
});
