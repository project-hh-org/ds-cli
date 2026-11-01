import { isRatedUsage } from "@dsmith-dev/core";
import { sharesFromIndex } from "@dsmith-dev/detect";
import { describe, expect, it } from "vitest";
import { planMigration, projectStyles, residualByCategory, usageKey } from "../src/index.js";
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
