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
    expect(await runDecideExplain(root, "Butto", { git: false })).toEqual({
      error: "not-found",
      message: "결정할 항목이 아님: Butto. list_decisions(또는 decide --list)로 항목을 확인하세요",
      candidates: ["Button"],
    });
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
    expect(after.filter((i) => i.status === "decided").map((i) => [i.item, i.chosen])).toEqual([["Badge", "src/components/Badge"]]);
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
    await expect(runDecideList(empty)).rejects.toThrow("먼저 `dsmith audit`을 실행하세요 (MCP 서버는 첫 호출 때 자동 생성)");
    await expect(runDecideExplain(empty, "Button")).rejects.toThrow("먼저 `dsmith audit`을 실행하세요 (MCP 서버는 첫 호출 때 자동 생성)");
    await expect(runDecideChoose(empty, "Button", "x")).rejects.toThrow("먼저 `dsmith audit`을 실행하세요 (MCP 서버는 첫 호출 때 자동 생성)");
  });
});

/** Button이 duplicate(a/Button vs b/Button)이면서 local-definition(src/x.tsx, src/y.tsx)이기도 한 작은 레포 */
async function bothKindsRepo(): Promise<string> {
  const root = path.join(tmp, "both");
  const put = (rel: string, code: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), code);
  };
  put("package.json", JSON.stringify({ name: "both", dependencies: { react: "^18" } }));
  put("src/a/Button.tsx", `export const Button = () => <button style={{ color: "#111111" }} />;\n`);
  put("src/b/Button.tsx", `export const Button = () => <button style={{ color: "#222222" }} />;\n`);
  put("src/PageA.tsx", `import { Button } from "./a/Button";\nexport const PageA = () => <Button />;\n`);
  put("src/PageB.tsx", `import { Button } from "./b/Button";\nexport const PageB = () => <Button />;\n`);
  put("src/x.tsx", `const Button = () => <button />;\nexport const X = () => <Button />;\n`);
  put("src/y.tsx", `const Button = () => <button />;\nexport const Y = () => <Button />;\n`);
  await runAudit(root);
  return root;
}

describe("같은 이름이 duplicate이면서 local-definition", { timeout: 30_000 }, () => {
  it("kind 없이 explain하면 ambiguous-kind, kind를 주면 각각 열린다", async () => {
    const root = await bothKindsRepo();
    expect(await runDecideExplain(root, "Button", { git: false })).toEqual({
      error: "ambiguous-kind",
      kinds: ["duplicate", "local-definition"],
    });
    const local = await runDecideExplain(root, "Button", { git: false, kind: "local-definition" });
    if (!("card" in local)) throw new Error("card 아님");
    expect(local.card.options.map((o) => o.id)).toEqual(["src/x.tsx", "src/y.tsx"]);
  });

  it("choose는 id가 속한 후보를 골라 기록하므로 지역 정의도 결정할 수 있다", async () => {
    const root = await bothKindsRepo();
    await runDecideChoose(root, "Button", "src/x.tsx");
    await runDecideChoose(root, "Button", "src/a/Button");
    const items = (await runDecideList(root)).map((i) => [i.item, i.kind, i.status]);
    expect(items).toEqual([
      ["Button", "duplicate", "decided"],
      ["Button", "local-definition", "decided"],
    ]);
    await expect(runDecideChoose(root, "Button", "src/x.tsx", undefined, { kind: "duplicate" })).rejects.toThrow("선택지 아님");
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
    expect(run(root, "--list", "--status", "decided", "--json").stdout).toContain('"chosen": "src/components/Badge"');
  });

  it("--list --limit은 앞의 N개만 보이고 나머지를 건수로 알린다", async () => {
    const root = await audited("examples", "legacy-demo");
    const human = run(root, "--list", "--limit", "1").stdout.trimEnd().split("\n");
    expect(human[0]).toBe("pending 2건 / decided 0건");
    expect(human).toHaveLength(3);
    expect(human[2]).toMatch(/^… 외 1건/);
    expect(JSON.parse(run(root, "--list", "--limit", "1", "--json").stdout)).toHaveLength(1);
    expect(run(root, "--list", "--limit", "0").status).toBe(1);
    expect(run(root, "--explain", "Button", "--limit", "1").status).toBe(1);
  });

  it("--explain --json은 카드 자체를 쓴다({card} 래퍼 없음)", async () => {
    const root = await audited("examples", "legacy-demo");
    const r = run(root, "--explain", "Button", "--no-git", "--json");
    expect(r.status).toBe(0);
    const card = JSON.parse(r.stdout);
    expect(card).toMatchObject({ item: "Button", kind: "duplicate", styleScope: "file" });
    expect(card).not.toHaveProperty("card");
    expect(card.ruleCheck).toHaveProperty("tokenUsageRate");
  });

  it("없는 항목 --explain --json은 stdout에 JSON 에러를 쓰고 종료 코드 1", async () => {
    const root = await audited("fixtures", "with-ds-app");
    const r = run(root, "--explain", "Butto", "--no-git", "--json");
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({
      error: "not-found",
      message: "결정할 항목이 아님: Butto. list_decisions(또는 decide --list)로 항목을 확인하세요",
      candidates: ["Button"],
    });
  });

  it("종류가 어긋난 --kind는 not-found에 availableKinds를 싣는다", async () => {
    const root = await audited("fixtures", "with-ds-app");
    const r = run(root, "--explain", "Button", "--kind", "local-definition", "--no-git", "--json");
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ error: "not-found", candidates: [], availableKinds: ["duplicate"] });
  });

  it("모호한 항목은 --kind로 지정한다 — ambiguous-kind는 JSON 에러·종료 코드 1", async () => {
    const root = await bothKindsRepo();
    const amb = run(root, "--explain", "Button", "--no-git", "--json");
    expect(amb.status).toBe(1);
    expect(JSON.parse(amb.stdout)).toEqual({ error: "ambiguous-kind", kinds: ["duplicate", "local-definition"] });
    expect(run(root, "--explain", "Button", "--no-git").stdout).toContain("--kind");
    const ok = run(root, "--explain", "Button", "--no-git", "--kind", "local-definition", "--json");
    expect(JSON.parse(ok.stdout).kind).toBe("local-definition");
    expect(run(root, "--explain", "Button", "--kind", "token-cluster").status).toBe(1);
    expect(run(root, "--item", "Button", "--choose", "src/y.tsx").stdout).toContain("결정 기록: Button → src/y.tsx");
  });

  it("같은 선택을 다시 기록해도 decisions.json이 바이트 동일하다", async () => {
    const root = await audited("examples", "legacy-demo");
    run(root, "--item", "Badge", "--choose", "src/components/Badge", "--note", "통일");
    const file = path.join(root, ".dsmith", "decisions.json");
    const before = fs.readFileSync(file, "utf-8");
    run(root, "--item", "Badge", "--choose", "src/components/Badge", "--note", "통일");
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
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
    expect(r.stdout).toContain("list_decisions(또는 decide --list)로 항목을 확인하세요");
    expect(r.stdout).toContain("비슷한 항목: Button");
  });
});

describe("dsmith decide --kind token-cluster", { timeout: 30_000 }, () => {
  const run = (root: string, ...args: string[]) =>
    spawnSync(process.execPath, [bin, "decide", ...args, "--root", root], { encoding: "utf-8" });

  /** legacy-demo 인덱스의 hardcoded 색 hex 둘로 token-cluster 기록을 심는다. */
  async function seeded(): Promise<{ root: string; hexes: string[] }> {
    const root = await audited("examples", "legacy-demo");
    const index = JSON.parse(fs.readFileSync(path.join(root, ".dsmith", "index.json"), "utf-8")) as {
      styles: { source: string; normalized: { kind: string; hex?: string } }[];
    };
    const hexes = [
      ...new Set(index.styles.filter((s) => s.source === "hardcoded" && s.normalized.kind === "color").map((s) => s.normalized.hex as string)),
    ].slice(0, 2);
    expect(hexes).toHaveLength(2);
    fs.writeFileSync(
      path.join(root, ".dsmith", "decisions.json"),
      JSON.stringify({ version: 1, items: [{ item: "blue-400", kind: "token-cluster", status: "pending", options: hexes }] }),
    );
    return { root, hexes };
  }

  it("--explain --json은 token-cluster 카드를 쓴다", async () => {
    const { root, hexes } = await seeded();
    const r = run(root, "--explain", "blue-400", "--kind", "token-cluster", "--json");
    expect(r.status).toBe(0);
    const card = JSON.parse(r.stdout);
    expect(card).toMatchObject({ item: "blue-400", kind: "token-cluster" });
    expect(card.options.map((o: { id: string }) => o.id).sort()).toEqual([...hexes].sort());
  });

  it("--choose는 기록하고 --list에 token-cluster가 나온다", async () => {
    const { root, hexes } = await seeded();
    const chosen = hexes[1] as string;
    expect(run(root, "--item", "blue-400", "--choose", chosen, "--kind", "token-cluster").stdout).toBe(
      `결정 기록: blue-400 → ${chosen} (.dsmith/decisions.json)\n`,
    );
    const list = JSON.parse(run(root, "--list", "--json").stdout) as { item: string; kind: string; status: string }[];
    expect(list.find((i) => i.item === "blue-400")).toMatchObject({ kind: "token-cluster", status: "decided" });
    expect(run(root, "--item", "blue-400", "--choose", "#000001", "--kind", "token-cluster").status).toBe(1);
  });

  it("선택 뒤 선택지가 바뀌면 --list가 stale을 표시한다", async () => {
    const { root, hexes } = await seeded();
    fs.writeFileSync(
      path.join(root, ".dsmith", "decisions.json"),
      JSON.stringify({
        version: 1,
        items: [{ item: "blue-400", kind: "token-cluster", status: "decided", options: hexes, chosen: "#000001" }],
      }),
    );
    expect(run(root, "--list").stdout).toContain("— 결정: #000001 (stale — 선택지가 바뀜, 다시 결정)");
  });
});

describe("dsmith decide --map", { timeout: 30_000 }, () => {
  const run = (root: string, ...args: string[]) =>
    spawnSync(process.execPath, [bin, "decide", ...args, "--root", root], { encoding: "utf-8" });
  const DS = "src/components/ui/button";

  it("--map을 반복해 기록의 mapping에 싣는다", async () => {
    const root = await audited("examples", "legacy-demo");
    const r = run(root, "--item", "Button", "--choose", DS, "--map", "kind:variant", "--map", "variant=primary:variant=default", "--json");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).mapping).toEqual({ kind: "variant", "variant=primary": "variant=default" });
    const saved = JSON.parse(fs.readFileSync(path.join(root, ".dsmith", "decisions.json"), "utf-8"));
    expect(saved.items[0].mapping).toEqual({ kind: "variant", "variant=primary": "variant=default" });
  });

  it("형식 위반은 종료 코드 1이고 decisions.json을 만들지 않는다", async () => {
    const root = await audited("examples", "legacy-demo");
    for (const bad of ["nocolon", ":b", "a:", "a=1:b", "a=b=c:d"]) {
      const r = run(root, "--item", "Button", "--choose", DS, "--map", bad);
      expect(r.status, bad).toBe(1);
      expect(r.stderr).toContain("오류:");
    }
    expect(fs.existsSync(path.join(root, ".dsmith", "decisions.json"))).toBe(false);
  });

  it("--map은 --choose와 함께만 쓴다", async () => {
    const root = await audited("examples", "legacy-demo");
    expect(run(root, "--list", "--map", "a:b").status).toBe(1);
  });

  it("같은 선택·같은 mapping을 다시 기록해도 파일이 바이트 동일하다", async () => {
    const root = await audited("examples", "legacy-demo");
    const args = ["--item", "Button", "--choose", DS, "--map", "kind:variant"];
    run(root, ...args);
    const file = path.join(root, ".dsmith", "decisions.json");
    const before = fs.readFileSync(file, "utf-8");
    run(root, ...args);
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });
});
