import { isRatedUsage, type ComponentUsage } from "@dsmith-dev/core";
import { sharesFromIndex } from "@dsmith-dev/detect";
import { describe, expect, it } from "vitest";
import { planMigration, projectComponents, projectStyles, residualByCategory, usageKey, type FilePlan } from "../src/index.js";
import { auditFixture, loadState, syntheticRepo } from "./helpers.js";

describe("project", () => {
  it("projectStyles는 계획된 사용만 token으로 바꾸고 hardcodedShare가 줄어든다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { detect, index, extractors } = await loadState(root);
    const plan = await planMigration({ root, detect, index, extractors });
    const projected = projectStyles(index.styles, plan);

    const planKeys = new Set(plan.files.flatMap((f) => f.replacements.map(usageKey)));
    const changed = projected.filter((u, i) => u !== index.styles[i]);
    expect(changed).toHaveLength(plan.planned);
    expect(changed.every((u) => u.source === "token" && planKeys.has(usageKey(u)))).toBe(true);

    const before = sharesFromIndex(index, detect.ds);
    const after = sharesFromIndex({ ...index, styles: projected }, detect.ds);
    expect(after.hardcodedShare).toBeLessThan(before.hardcodedShare);
    expect(projectStyles(index.styles, { ...plan, files: [] })).toBe(index.styles);
  });

  it("projectComponents는 계획된 import 편집의 파일에서 그 항목의 사용을 대상 module로 옮긴다 (I3)", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { detect, index, extractors } = await loadState(root);
    const plan = await planMigration({ root, detect, index, extractors });
    const use = (file: string, module: string, extra: Partial<ComponentUsage> = {}): ComponentUsage => ({
      file,
      line: 1,
      name: "Button",
      importedFrom: module,
      module,
      props: [],
      ...extra,
    });
    const components: ComponentUsage[] = [
      use("a.tsx", "src/old/button"), // 옮김
      use("a.tsx", "src/old/button", { name: "Btn", imported: "Button" }), // 별칭 — 원래 이름으로 옮김
      use("a.tsx", "@mui/material"), // from에 없는 module은 그대로
      use("a.tsx", "src/old/button", { name: "Card" }), // 다른 항목
      use("b.tsx", "src/old/button"), // 편집 계획이 없는 파일
      { ...use("c.tsx", ""), importedFrom: null, declaredLocally: true }, // 지역 정의 사용 → 옮김
    ];
    const file = (name: string, importTargets: FilePlan["importTargets"]): FilePlan => ({ file: name, sha256: "", replacements: [], components: [], componentChecks: [], importTargets, patches: [] });
    const projected = projectComponents(components, {
      ...plan,
      files: [
        file("a.tsx", [{ item: "Button", kind: "duplicate", module: "src/ds/button", from: ["src/old/button", "src/other/button"] }]),
        file("c.tsx", [{ item: "Button", kind: "local-definition", module: "src/ds/button", from: ["src/ds/button"] }]),
      ],
    });
    expect(projected[0]).toMatchObject({ module: "src/ds/button", importedFrom: "src/ds/button" });
    expect(projected[1]).toMatchObject({ name: "Btn", imported: "Button", module: "src/ds/button" });
    expect(projected[2]).toBe(components[2]);
    expect(projected[3]).toBe(components[3]);
    expect(projected[4]).toBe(components[4]);
    expect(projected[5]).toMatchObject({ module: "src/ds/button", importedFrom: "src/ds/button" });
    expect(projected[5]).not.toHaveProperty("declaredLocally");
    expect(projectComponents(components, { ...plan, files: [] })).toBe(components);
  });

  it("residualByCategory는 대상 속성의 남은 hardcoded를 센다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { detect, index, extractors } = await loadState(root);
    const plan = await planMigration({ root, detect, index, extractors });
    const before = residualByCategory(index.styles);
    const after = residualByCategory(projectStyles(index.styles, plan));
    expect(before.color - after.color).toBe(plan.byCategory.color);
    expect(before.spacing - after.spacing).toBe(plan.byCategory.spacing);
    expect(residualByCategory(index.styles, (f) => f.startsWith("src/")).color).toBe(0);
    expect(index.styles.some(isRatedUsage)).toBe(true);
  });
});
