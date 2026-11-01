import { describe, expect, it } from "vitest";
import { catalogFromDir } from "../src/index.js";
import { auditFixture, copyFixture, overlay } from "./helpers.js";

describe("catalogFromDir", () => {
  it("stories·테스트·d.ts 파일은 컴포넌트로 읽지 않고 origin·file을 채운다", async () => {
    const root = copyFixture("with-ds-app", {
      ...overlay,
      "components/ui/Badge.test.tsx": "export function BadgeTest() { return null; }\n",
      "components/ui/types.d.ts": "export declare function Ghost(): null;\n",
      "components/ui/__tests__/X.tsx": "export function Hidden() { return null; }\n",
    });
    const { index } = await auditFixture(root);
    const { components, warnings } = await catalogFromDir(root, "components/ui", "ds-local", index);
    expect(components.map((c) => c.name)).toEqual(["Badge", "Button", "OldButton"]);
    expect(components.every((c) => c.origin === "ds-local" && c.file?.startsWith("components/ui/"))).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("tokensUsed는 같은 파일의 token 출처 스타일 raw(고유, ≤10)", async () => {
    const root = copyFixture("with-ds-app", overlay);
    const { index } = await auditFixture(root);
    const { components } = await catalogFromDir(root, "components/ui", "ds-local", index);
    for (const c of components) expect((c.tokensUsed ?? []).length).toBeLessThanOrEqual(10);
    const fromIndex = new Set(index.styles.filter((s) => s.file === "components/ui/Button.tsx" && s.source === "token").map((s) => s.raw));
    expect(new Set(components.find((c) => c.name === "Button")?.tokensUsed ?? [])).toEqual(fromIndex);
  });
});
