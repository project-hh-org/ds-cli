import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { explainDecision } from "../src/decisions/explain.js";
import type { Index } from "../src/index/indexer.js";
import type { ComponentUsage } from "../src/model/component-usage.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-explain-"));
  for (const rel of ["ui/Button.tsx", "legacy/Button.tsx"]) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), "export const Button = () => null;\n");
  }
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function cu(p: Partial<ComponentUsage> & { name: string }): ComponentUsage {
  return { file: "src/App.tsx", line: 1, importedFrom: null, module: "", props: [], ...p };
}
const index: Index = {
  root: "/r",
  createdAt: "t",
  extractors: [],
  files: { scanned: 1, skipped: [] },
  styles: [],
  components: [
    cu({ name: "Button", module: "ui/Button", importedFrom: "ui/Button" }),
    cu({ name: "Button", module: "legacy/Button", importedFrom: "legacy/Button" }),
    cu({ name: "Button", module: "legacy/Button", importedFrom: "legacy/Button" }),
  ],
};
const isDsModule = (m: string): boolean => m.startsWith("ui/");

describe("explainDecision", () => {
  it("정의 파일을 풀고 DS 옵션을 추천하며, git이 레포가 아니어도 history만 생략한다", async () => {
    const result = await explainDecision(tmp, index, "Button", { isDsModule });
    if (!("card" in result)) throw new Error("not-found");
    expect(result.card.options.map((o) => [o.id, o.file])).toEqual([
      ["legacy/Button", "legacy/Button.tsx"],
      ["ui/Button", "ui/Button.tsx"],
    ]);
    expect(result.card.recommendation).toMatchObject({ optionId: "ui/Button", rule: "ds-module" });
    expect(result.card).not.toHaveProperty("history");
  });

  it("git 레포면 정의 파일 이력을 옵션 id로 싣는다", async () => {
    const run = (...args: string[]) => execFileSync("git", args, { cwd: tmp, stdio: "ignore" });
    run("init", "-q");
    run("add", "ui/Button.tsx");
    run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "ui");
    const result = await explainDecision(tmp, index, "Button", { isDsModule });
    if (!("card" in result)) throw new Error("not-found");
    expect(Object.keys(result.card.history?.byOption ?? {})).toEqual(["ui/Button"]);
    expect(result.card.history?.byOption["ui/Button"]?.authorsCount).toBe(1);

    const noGit = await explainDecision(tmp, index, "Button", { isDsModule, git: false });
    if (!("card" in noGit)) throw new Error("not-found");
    expect(noGit.card).not.toHaveProperty("history");
  });

  it("decisions 기록이 decided면 카드에 decided가 실린다", async () => {
    const result = await explainDecision(tmp, index, "Button", {
      isDsModule,
      git: false,
      decisions: {
        version: 1,
        items: [
          { item: "Button", kind: "duplicate", status: "decided", options: [], chosen: "ui/Button", decidedAt: "2026-11-01T00:00:00.000Z" },
        ],
      },
    });
    if (!("card" in result)) throw new Error("not-found");
    expect(result.card.decided).toEqual({ chosen: "ui/Button", decidedAt: "2026-11-01T00:00:00.000Z" });
  });

  it("없는 항목이면 이름이 겹치는 후보를 최대 5개 돌려준다", async () => {
    expect(await explainDecision(tmp, index, "Butto", { isDsModule, git: false })).toEqual({
      error: "not-found",
      candidates: ["Button"],
    });
    expect(await explainDecision(tmp, index, "zzz", { isDsModule, git: false })).toEqual({
      error: "not-found",
      candidates: [],
    });
  });
});

describe("explainDecision 같은 이름이 duplicate이면서 local-definition", () => {
  const both: Index = {
    ...index,
    components: [
      ...index.components,
      cu({ name: "Button", file: "src/x.tsx", declaredLocally: true }),
      cu({ name: "Button", file: "src/y.tsx", declaredLocally: true }),
    ],
  };

  it("kind가 없으면 가능한 kind를 담은 ambiguous-kind", async () => {
    expect(await explainDecision(tmp, both, "Button", { isDsModule, git: false })).toEqual({
      error: "ambiguous-kind",
      kinds: ["duplicate", "local-definition"],
    });
  });

  it("kind로 각각 열 수 있다", async () => {
    const dup = await explainDecision(tmp, both, "Button", { isDsModule, git: false, kind: "duplicate" });
    const local = await explainDecision(tmp, both, "Button", { isDsModule, git: false, kind: "local-definition" });
    if (!("card" in dup) || !("card" in local)) throw new Error("card 아님");
    expect(dup.card.options.map((o) => o.id).sort()).toEqual(["legacy/Button", "ui/Button"]);
    expect(local.card.options.map((o) => o.id)).toEqual(["src/x.tsx", "src/y.tsx"]);
  });

  it("그 kind에 없으면 not-found", async () => {
    const r = await explainDecision(tmp, index, "Button", { isDsModule, git: false, kind: "local-definition" });
    expect(r).toMatchObject({ error: "not-found" });
  });
});

describe("explainDecision 옵션 상한", () => {
  const many = (n: number): Index => ({
    ...index,
    components: Array.from({ length: n }, (_, i) =>
      cu({ name: "Container", module: `src/c${i}/Container`, importedFrom: `src/c${i}/Container`, file: `src/p${i}.tsx`, props: ["children", `prop${i}`] }),
    ),
  });

  it("옵션 120개여도 카드는 ~8KB 이내이고 omittedOptions를 싣는다", async () => {
    const result = await explainDecision(tmp, many(120), "Container", { isDsModule: () => false, git: false });
    if (!("card" in result)) throw new Error("not-found");
    expect(result.card.options.length).toBeLessThanOrEqual(21);
    expect(result.card.omittedOptions).toMatchObject({ count: 120 - result.card.options.length });
    expect(JSON.stringify(result.card).length).toBeLessThan(8 * 1024);
  });

  it("maxOptions로 조절하고, 추천 옵션은 상한 밖이어도 싣는다", async () => {
    const result = await explainDecision(tmp, many(30), "Container", {
      isDsModule: (m) => m === "src/c29/Container",
      git: false,
      maxOptions: 3,
    });
    if (!("card" in result)) throw new Error("not-found");
    expect(result.card.options).toHaveLength(4);
    expect(result.card.options.map((o) => o.id)).toContain("src/c29/Container");
    expect(result.card.recommendation.optionId).toBe("src/c29/Container");
  });

  it("git 이력은 카드에 실리는 옵션만 읽는다", async () => {
    const run = (...args: string[]) => execFileSync("git", args, { cwd: tmp, stdio: "ignore" });
    for (let i = 0; i < 30; i++) {
      const rel = `src/c${i}/Container.tsx`;
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), "x");
    }
    run("init", "-q");
    run("add", ".");
    run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "all");
    const result = await explainDecision(tmp, many(30), "Container", { isDsModule: () => false, maxOptions: 4 });
    if (!("card" in result)) throw new Error("not-found");
    expect(result.card.options).toHaveLength(4);
    expect(Object.keys(result.card.history?.byOption ?? {}).sort()).toEqual(result.card.options.map((o) => o.id).sort());
  });
});
