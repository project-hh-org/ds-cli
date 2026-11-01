import fs from "node:fs";
import path from "node:path";
import { readMigration, writePatchedFile } from "@dsmith-dev/core";
import type { Extractor } from "@dsmith-dev/extractor-api";
import { cssExtractor } from "@dsmith-dev/extractor-css";
import { describe, expect, it } from "vitest";
import { applyMigration, planMigration, revertMigration, type MigratePlan } from "../src/index.js";
import { auditFixture, listFiles, loadState, read, syntheticRepo, treeHash } from "./helpers.js";

/** 계획된 파일의 첫 패치 치환문을 바꾼다 — 깨진 패치를 흉내 낸다. 원문 조각은 파일에서 읽어 넘긴다 */
function corrupt(root: string, plan: MigratePlan, file: string, make: (original: string) => string): void {
  const fp = plan.files.find((f) => f.file === file);
  if (fp === undefined) throw new Error(`계획에 ${file}이 없음`);
  const code = fs.readFileSync(path.join(root, file), "utf-8");
  const p = fp.patches[0]!;
  fp.patches[0] = { ...p, replacement: make(code.slice(p.start, p.end)) };
}

async function planned(root: string) {
  const state = await loadState(root);
  const extractors: Extractor[] = state.extractors;
  const plan = await planMigration({ root, ...state, extractors });
  return { plan, extractors, state };
}

describe("applyMigration", () => {
  it("계획을 적용하고 기록을 남긴다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { plan, extractors } = await planned(root);
    const before = read(root, "src/a.css");
    const result = await applyMigration(root, plan, { extractors, version: "9.9.9", now: new Date(2026, 10, 1, 14, 30, 5) });

    expect(result.id).toBe("20261101-143005");
    expect(result.record).toBe(".dsmith/migrations/20261101-143005.json");
    expect(result.files.every((f) => f.status === "applied")).toBe(true);
    expect(result.replaced).toBe(plan.planned);
    expect(result.skipped).toEqual({});

    const css = read(root, "src/a.css");
    expect(css).not.toBe(before);
    expect(css).toContain("color: var(--color-brand)");
    expect(css).toContain("padding: var(--space-4)");
    expect(css).toContain("width: 33px"); // 토큰 대상 아님
    expect(read(root, "src/C.tsx")).toContain('backgroundColor: "var(--color-brand)"');

    const rec = (await readMigration(root, result.id))!;
    expect(rec.status).toBe("applied");
    expect(rec.dsmith).toBe("9.9.9");
    expect(rec.summary).toEqual({ tokens: plan.planned, components: 0, files: plan.files.length });
    for (const f of rec.files) {
      expect(f.status).toBe("applied");
      expect(f.before).not.toBe(f.after);
      for (const p of f.patches) expect(typeof p.original).toBe("string");
    }
  });

  it("계획 뒤 파일이 바뀌면 changed-since-plan이고 그 파일은 건드리지 않는다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { plan, extractors } = await planned(root);
    const edited = `${read(root, "src/a.css")}/* 손으로 고침 */\n`;
    fs.writeFileSync(path.join(root, "src/a.css"), edited);

    const result = await applyMigration(root, plan, { extractors, version: "t" });
    const a = result.files.find((f) => f.file === "src/a.css")!;
    expect(a.status).toBe("changed-since-plan");
    expect(read(root, "src/a.css")).toBe(edited);
    expect(result.files.filter((f) => f.status === "applied").length).toBe(plan.files.length - 1);
    expect(result.skipped["rolled-back"]).toBe(a.replacements);
    const rec = (await readMigration(root, result.id))!;
    expect(rec.files.find((f) => f.file === "src/a.css")?.status).toBe("rolled-back");
  });

  it("깨진 패치(구문 오류)는 그 파일만 rolled-back, 나머지는 적용", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { plan, extractors } = await planned(root);
    const original = read(root, "src/C.tsx");
    corrupt(root, plan, "src/C.tsx", () => '"var(--color-brand');

    const result = await applyMigration(root, plan, { extractors, version: "t" });
    const bad = result.files.find((f) => f.file === "src/C.tsx")!;
    expect(bad.status).toBe("rolled-back");
    expect(bad.reason).toMatch(/구문 오류|파싱/);
    expect(read(root, "src/C.tsx")).toBe(original);
    expect(result.skipped["rolled-back"]).toBe(bad.replacements);
    expect(result.files.filter((f) => f.status === "applied").length).toBe(plan.files.length - 1);
    expect(read(root, "src/a.css")).toContain("var(--color-brand)");
    const rec = (await readMigration(root, result.id))!;
    expect(rec.files.find((f) => f.file === "src/C.tsx")).toMatchObject({ status: "rolled-back" });
  });

  it("파싱은 통과해도 재추출 검증이 어긋나면 rolled-back", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { plan, extractors } = await planned(root);
    const original = read(root, "src/C.tsx");
    // 구문은 맞지만 여전히 hardcoded인 값으로 바꾼다
    corrupt(root, plan, "src/C.tsx", (orig) => orig.replace("3b82f6", "3b82f7"));

    const result = await applyMigration(root, plan, { extractors, version: "t" });
    const bad = result.files.find((f) => f.file === "src/C.tsx")!;
    expect(bad.status).toBe("rolled-back");
    expect(bad.reason).toMatch(/^재추출 검증 실패: hardcoded \d+→\d+, token \d+→\d+/);
    expect(read(root, "src/C.tsx")).toBe(original);
    expect(read(root, "src/B.tsx")).toContain("var(--color-brand)");
  });

  it("계획만 한 레포에는 .dsmith/migrations도 만들지 않는다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const hash = treeHash(root, { includeDsmith: true });
    await planned(root);
    expect(treeHash(root, { includeDsmith: true })).toBe(hash);
    expect(listFiles(root, ".dsmith/migrations")).toEqual([]);
  });

  it("css Extractor만으로도 같은 결과 (extractors 인자는 계획과 같아야 한다)", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const state = await loadState(root);
    const plan = await planMigration({ root, ...state, extractors: [cssExtractor], files: ["src/a.css"] });
    const result = await applyMigration(root, plan, { extractors: [cssExtractor], version: "t" });
    expect(result.files).toHaveLength(1);
  });
});

describe("applyMigration — 쓰기 오류 격리 (I2)", () => {
  it("N번째 파일의 쓰기가 던져도 나머지는 계속 적용하고 기록·결과에 사유를 남긴다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { plan, extractors } = await planned(root);
    expect(plan.files.map((f) => f.file)).toEqual(["src/B.tsx", "src/C.tsx", "src/a.css"]);
    const originalC = read(root, "src/C.tsx");
    const calls: string[] = [];
    const flaky: typeof writePatchedFile = async (r, file, sha, content) => {
      calls.push(file);
      if (file === "src/C.tsx") throw new Error("EIO: i/o error, write");
      return writePatchedFile(r, file, sha, content);
    };

    const result = await applyMigration(root, plan, { extractors, version: "t", writeFile: flaky });
    expect(calls).toEqual(["src/B.tsx", "src/C.tsx", "src/a.css"]); // 실패 뒤에도 다음 파일을 쓴다
    expect(result.files.map((f) => [f.file, f.status])).toEqual([
      ["src/B.tsx", "applied"],
      ["src/C.tsx", "write-failed"],
      ["src/a.css", "applied"],
    ]);
    expect(result.files[1]?.reason).toBe("쓰기 실패: EIO: i/o error, write");
    expect(read(root, "src/C.tsx")).toBe(originalC);
    expect(read(root, "src/B.tsx")).toContain("var(--color-brand)");
    expect(read(root, "src/a.css")).toContain("var(--color-brand)");
    const lostC = plan.files[1]!.replacements.length;
    expect(result.skipped["rolled-back"]).toBe(lostC);
    expect(result.replaced).toBe(plan.planned - lostC);

    const rec = (await readMigration(root, result.id))!;
    expect(rec.status).toBe("applied");
    expect(rec.summary).toEqual({ tokens: plan.planned - lostC, components: 0, files: 2 });
    expect(rec.files.map((f) => f.status)).toEqual(["applied", "rolled-back", "applied"]);
    expect(rec.files[1]?.reason).toBe("쓰기 실패: EIO: i/o error, write");

    // 되돌리기는 적용된 두 파일만 되돌리고 실패한 파일은 건드리지 않는다
    const reverted = await revertMigration(root, result.id);
    expect(reverted.files.map((f) => f.file)).toEqual(["src/B.tsx", "src/a.css"]);
    expect(reverted.files.every((f) => f.status === "reverted")).toBe(true);
  });

  it("기록의 summary는 파일마다 갱신된다 (중간에 끊겨도 --list가 지금까지 쓴 만큼을 보인다)", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { plan, extractors } = await planned(root);
    const seen: { tokens: number; files: number }[] = [];
    const spy: typeof writePatchedFile = async (r, file, sha, content) => {
      const id = fs.readdirSync(path.join(root, ".dsmith/migrations"))[0]!.replace(/\.json$/, "");
      const rec = await readMigration(root, id);
      seen.push({ tokens: rec!.summary.tokens, files: rec!.summary.files });
      return writePatchedFile(r, file, sha, content);
    };
    await applyMigration(root, plan, { extractors, version: "t", writeFile: spy });
    expect(seen[0]).toEqual({ tokens: 0, files: 0 });
    expect(seen[1]!.files).toBe(1);
    expect(seen[1]!.tokens).toBe(plan.files[0]!.replacements.length);
    expect(seen[2]!.files).toBe(2);
  });

  it("기록은 close 사용 여부를 저장한다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const state = await loadState(root);
    const base = await applyMigration(root, await planMigration({ root, ...state }), { extractors: state.extractors, version: "t", now: new Date(2026, 10, 1, 1, 0, 0) });
    expect((await readMigration(root, base.id))!.close).toBe(false);
    const withClose = await applyMigration(root, await planMigration({ root, ...state, close: true }), { extractors: state.extractors, version: "t", now: new Date(2026, 10, 1, 1, 0, 1) });
    // 같은 파일이 이미 바뀌어 계획 뒤 변경이 되지만 기록의 close 값은 계획의 값이다
    expect((await readMigration(root, withClose.id))!.close).toBe(true);
  });
});
