import fs from "node:fs";
import path from "node:path";
import { readMigration } from "@dsmith-dev/core";
import { describe, expect, it } from "vitest";
import { applyMigration, planMigration, revertMigration } from "../src/index.js";
import { auditFixture, loadState, read, syntheticRepo, treeHash } from "./helpers.js";

async function applied(root: string) {
  const state = await loadState(root);
  const plan = await planMigration({ root, ...state });
  const result = await applyMigration(root, plan, { extractors: state.extractors, version: "t" });
  return { plan, result };
}

describe("revertMigration", () => {
  it("적용 → 되돌리기 → 트리 해시(.dsmith 제외)가 적용 전과 같다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const hash = treeHash(root);
    const { result } = await applied(root);
    expect(treeHash(root)).not.toBe(hash);

    const reverted = await revertMigration(root, result.id);
    expect(reverted.files.every((f) => f.status === "reverted")).toBe(true);
    expect(treeHash(root)).toBe(hash);
    expect((await readMigration(root, result.id))!.status).toBe("reverted");
  });

  it("두 번 되돌리면 already-original", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { result } = await applied(root);
    await revertMigration(root, result.id);
    const second = await revertMigration(root, result.id);
    expect(second.files.every((f) => f.status === "already-original")).toBe(true);
  });

  it("적용 뒤 고친 파일은 skipped-modified로 두고 나머지만 되돌린다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const original = read(root, "src/C.tsx");
    const { result } = await applied(root);
    const edited = `${read(root, "src/a.css")}/* 적용 뒤 수정 */\n`;
    fs.writeFileSync(path.join(root, "src/a.css"), edited);

    const reverted = await revertMigration(root, result.id);
    expect(reverted.files.find((f) => f.file === "src/a.css")).toMatchObject({ status: "skipped-modified", reason: "적용 뒤 수정됨" });
    expect(reverted.files.filter((f) => f.status === "reverted").length).toBe(reverted.files.length - 1);
    expect(read(root, "src/a.css")).toBe(edited);
    expect(read(root, "src/C.tsx")).toBe(original);
    expect((await readMigration(root, result.id))!.status).toBe("applied");
  });

  it("없는 id는 에러", async () => {
    const root = syntheticRepo();
    await expect(revertMigration(root, "20000101-000000")).rejects.toThrow("마이그레이션 기록이 없음");
  });
});
