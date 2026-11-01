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
