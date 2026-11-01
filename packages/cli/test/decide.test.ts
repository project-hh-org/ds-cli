import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/commands/audit.js";
import { runDecideChoose, runDecideExplain, runDecideList } from "../src/commands/decide.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const bin = path.resolve(here, "../dist/bin.js");

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-decide-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** fixture를 임시 디렉터리로 복사해 audit까지 돌린다(e2e가 원본 .dsmith/를 병렬로 지우므로 원본에 쓰지 않는다). */
async function audited(base: "fixtures" | "examples", name: string): Promise<string> {
  const dest = path.join(tmp, name);
  fs.cpSync(path.join(repoRoot, base, name), dest, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes(".dsmith"),
  });
  await runAudit(dest);
  return dest;
}

describe("runDecideExplain: fixtures/with-ds-app", () => {
  it("Button: 옵션 2개, DS 모듈 추천(high), git:false면 history 없음", async () => {
    const root = await audited("fixtures", "with-ds-app");
    const result = await runDecideExplain(root, "Button", { git: false });
    if (!("card" in result)) throw new Error("not-found");
    const { card } = result;
    expect(card.kind).toBe("duplicate");
    expect(card.options.map((o) => o.id).sort()).toEqual(["components/ui/Button", "src/legacy/Button"]);
    expect(card.recommendation).toMatchObject({
      optionId: "components/ui/Button",
      rule: "ds-module",
      confidence: "high",
    });
    expect(card).not.toHaveProperty("history");
    expect(card.options.every((o) => o.file !== undefined)).toBe(true);
  });

  it("Butto: not-found + 후보 [Button]", async () => {
    const root = await audited("fixtures", "with-ds-app");
    expect(await runDecideExplain(root, "Butto", { git: false })).toEqual({ error: "not-found", candidates: ["Button"] });
  });

  it("git 레포가 아니어도(기본 git:true) 예외 없이 history만 생략한다", async () => {
    const root = await audited("fixtures", "with-ds-app");
    const result = await runDecideExplain(root, "Button");
    if (!("card" in result)) throw new Error("not-found");
    expect(result.card).not.toHaveProperty("history");
  });
});

describe("runDecideExplain: examples/legacy-demo", () => {
  it("Button: 로컬 DS 쪽(ui/button)을 추천하고 props 차이를 보인다", async () => {
    const root = await audited("examples", "legacy-demo");
    const result = await runDecideExplain(root, "Button", { git: false });
    if (!("card" in result)) throw new Error("not-found");
    expect(result.card.recommendation.optionId).toBe("src/components/ui/button");
    expect(result.card.recommendation.rule).toBe("ds-module");
    expect(result.card.differences).toContainEqual({
      aspect: "props",
      byOption: { "src/components/Button": ["onClick"] },
    });
  });

  it("Badge: DS가 없어 근거가 약하다 — confidence low", async () => {
    const root = await audited("examples", "legacy-demo");
    const result = await runDecideExplain(root, "Badge", { git: false });
    if (!("card" in result)) throw new Error("not-found");
    expect(result.card.recommendation.confidence).toBe("low");
  });
});

describe("runDecideList / runDecideChoose: examples/legacy-demo", () => {
  it("pending 2건(Button, Badge) → Badge 결정 기록 → decided 1·pending 1", async () => {
    const root = await audited("examples", "legacy-demo");
    const before = await runDecideList(root);
    expect(before.map((i) => [i.item, i.status]).sort()).toEqual([["Badge", "pending"], ["Button", "pending"]]);

    const record = await runDecideChoose(root, "Badge", "src/components/Badge", "공용으로 통일");
    expect(record).toMatchObject({
      item: "Badge",
      kind: "duplicate",
      status: "decided",
      chosen: "src/components/Badge",
      note: "공용으로 통일",
    });
    expect(new Date(record.decidedAt ?? "").toISOString()).toBe(record.decidedAt);

    const saved = JSON.parse(fs.readFileSync(path.join(root, ".dsmith", "decisions.json"), "utf-8"));
    expect(saved.version).toBe(1);
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0].options).toEqual(expect.arrayContaining(["src/components/Badge", "src/components/common/StatusBadge"]));

    const after = await runDecideList(root);
    expect(after.filter((i) => i.status === "decided").map((i) => [i.item, i.decided])).toEqual([["Badge", "src/components/Badge"]]);
    expect(after.filter((i) => i.status === "pending").map((i) => i.item)).toEqual(["Button"]);
    expect((await runDecideList(root, "decided")).map((i) => i.item)).toEqual(["Badge"]);
    expect((await runDecideList(root, "pending")).map((i) => i.item)).toEqual(["Button"]);

    // 카드에도 결정이 실린다. 같은 항목을 다시 결정해도 기록은 1건이다.
    const card = await runDecideExplain(root, "Badge", { git: false });
    expect("card" in card && card.card.decided?.chosen).toBe("src/components/Badge");
    await runDecideChoose(root, "Badge", "src/components/common/StatusBadge");
    const again = JSON.parse(fs.readFileSync(path.join(root, ".dsmith", "decisions.json"), "utf-8"));
    expect(again.items).toHaveLength(1);
    expect(again.items[0]).toMatchObject({ chosen: "src/components/common/StatusBadge" });
    expect(again.items[0]).not.toHaveProperty("note");
  });

  it("선택지가 아닌 id면 가능한 id를 에러에 담는다", async () => {
    const root = await audited("examples", "legacy-demo");
    await expect(runDecideChoose(root, "Badge", "nope")).rejects.toThrow(/선택지 아님: nope\. 가능: .*src\/components\/Badge/);
    expect(fs.existsSync(path.join(root, ".dsmith", "decisions.json"))).toBe(false);
  });

  it("없는 항목이면 에러", async () => {
    const root = await audited("examples", "legacy-demo");
    await expect(runDecideChoose(root, "Nope", "x")).rejects.toThrow("결정할 항목이 아님: Nope");
  });

  it("audit 전이면 안내 에러", async () => {
    const empty = path.join(tmp, "empty");
    fs.mkdirSync(empty);
    await expect(runDecideList(empty)).rejects.toThrow("먼저 dsmith audit을 실행하세요");
    await expect(runDecideExplain(empty, "Button")).rejects.toThrow("먼저 dsmith audit을 실행하세요");
    await expect(runDecideChoose(empty, "Button", "x")).rejects.toThrow("먼저 dsmith audit을 실행하세요");
  });
});

describe("dsmith decide (bin)", { timeout: 30_000 }, () => {
  const run = (root: string, ...args: string[]) =>
    spawnSync(process.execPath, [bin, "decide", ...args, "--root", root], { encoding: "utf-8" });

  it("--list --json은 stdout에 JSON만 쓴다", async () => {
    const root = await audited("examples", "legacy-demo");
    const r = run(root, "--list", "--json");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).map((i: { item: string }) => i.item).sort()).toEqual(["Badge", "Button"]);
  });

  it("사람용 출력: list·explain·choose", async () => {
    const root = await audited("examples", "legacy-demo");
    expect(run(root, "--list").stdout).toMatch(/^pending 2건 \/ decided 0건\n- \[pending\] /);
    const explain = run(root, "--explain", "Button", "--no-git").stdout;
    expect(explain).toContain("Button (duplicate)");
    expect(explain).toContain("추천: src/components/ui/button (ds-module, high)");
    expect(run(root, "--item", "Badge", "--choose", "src/components/Badge").stdout).toBe(
      "결정 기록: Badge → src/components/Badge (.dsmith/decisions.json)\n",
    );
    expect(run(root, "--list").stdout).toMatch(/^pending 1건 \/ decided 1건\n/);
    expect(run(root, "--list", "--status", "decided", "--json").stdout).toContain('"decided": "src/components/Badge"');
  });

  it("모드가 정확히 하나가 아니면 에러(종료 코드 1)", async () => {
    const root = await audited("examples", "legacy-demo");
    for (const args of [[], ["--list", "--explain", "Button"], ["--choose", "x"]]) {
      const r = run(root, ...args);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("오류:");
    }
  });

  it("없는 항목 --explain은 종료 코드 1", async () => {
    const root = await audited("fixtures", "with-ds-app");
    const r = run(root, "--explain", "Butto", "--no-git");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("비슷한 항목: Button");
  });
});
