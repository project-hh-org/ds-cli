import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chooseDecision } from "../src/decisions/choose.js";
import { readDecisions } from "../src/decisions/store.js";
import type { Index } from "../src/index/indexer.js";
import type { ComponentUsage } from "../src/model/component-usage.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-choose-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function cu(p: Partial<ComponentUsage> & { name: string }): ComponentUsage {
  return { file: "src/App.tsx", line: 1, importedFrom: null, module: "", props: [], ...p };
}
/** Button이 duplicate(a/Button vs b/Button)이면서 local-definition(src/x.tsx, src/y.tsx)이기도 하다. */
const index: Index = {
  root: "/r",
  createdAt: "t",
  extractors: [],
  files: { scanned: 1, skipped: [] },
  styles: [],
  components: [
    cu({ name: "Button", module: "a/Button", importedFrom: "a/Button" }),
    cu({ name: "Button", module: "b/Button", importedFrom: "b/Button" }),
    cu({ name: "Button", file: "src/x.tsx", declaredLocally: true }),
    cu({ name: "Button", file: "src/y.tsx", declaredLocally: true }),
    cu({ name: "Solo", module: "a/Solo", importedFrom: "a/Solo" }),
    cu({ name: "Solo", module: "b/Solo", importedFrom: "b/Solo" }),
  ],
};
const decisionsText = (): string => fs.readFileSync(path.join(tmp, ".dsmith", "decisions.json"), "utf-8");

describe("chooseDecision", () => {
  it("선택지를 가진 후보를 골라 기록한다 — 모듈 id는 duplicate, 파일 id는 local-definition", async () => {
    const dup = await chooseDecision(tmp, index, "Button", "a/Button", { now: new Date("2026-11-01T00:00:00Z") });
    expect(dup).toMatchObject({ item: "Button", kind: "duplicate", status: "decided", chosen: "a/Button", decidedAt: "2026-11-01T00:00:00.000Z" });
    const local = await chooseDecision(tmp, index, "Button", "src/y.tsx");
    expect(local).toMatchObject({ kind: "local-definition", chosen: "src/y.tsx", options: ["src/x.tsx", "src/y.tsx"] });
    const file = await readDecisions(tmp);
    expect(file.items.map((r) => [r.kind, r.chosen])).toEqual([
      ["duplicate", "a/Button"],
      ["local-definition", "src/y.tsx"],
    ]);
  });

  it("kind를 주면 그 종류에서만 선택지를 찾는다", async () => {
    await expect(chooseDecision(tmp, index, "Button", "src/x.tsx", { kind: "duplicate" })).rejects.toThrow(
      /선택지 아님: src\/x\.tsx\. 가능: a\/Button, b\/Button/,
    );
  });

  it("어느 후보에도 없는 id면 가능한 id를 모두 에러에 담고 파일을 만들지 않는다", async () => {
    await expect(chooseDecision(tmp, index, "Button", "nope")).rejects.toThrow(
      /선택지 아님: nope\. 가능: a\/Button, b\/Button, src\/x\.tsx, src\/y\.tsx/,
    );
    expect(fs.existsSync(path.join(tmp, ".dsmith", "decisions.json"))).toBe(false);
  });

  it("없는 항목이면 비슷한 항목을 알려준다", async () => {
    await expect(chooseDecision(tmp, index, "Solos", "x")).rejects.toThrow("결정할 항목이 아님: Solos.");
    await expect(chooseDecision(tmp, index, "Sol", "x")).rejects.toThrow("비슷한 항목: Solo");
  });

  it("같은 선택·같은 메모로 다시 결정하면 파일이 바이트 동일하다(decidedAt 유지)", async () => {
    await chooseDecision(tmp, index, "Solo", "a/Solo", { note: "n", now: new Date("2026-11-01T00:00:00Z") });
    const before = decisionsText();
    const again = await chooseDecision(tmp, index, "Solo", "a/Solo", { note: "n", now: new Date("2030-01-01T00:00:00Z") });
    expect(decisionsText()).toBe(before);
    expect(again.decidedAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it("선택이나 메모가 바뀌면 갱신하고 기록은 1건이다", async () => {
    await chooseDecision(tmp, index, "Solo", "a/Solo", { note: "n", now: new Date("2026-11-01T00:00:00Z") });
    await chooseDecision(tmp, index, "Solo", "a/Solo", { now: new Date("2026-11-02T00:00:00Z") });
    let items = (await readDecisions(tmp)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("note");
    expect(items[0]?.decidedAt).toBe("2026-11-02T00:00:00.000Z");
    await chooseDecision(tmp, index, "Solo", "b/Solo");
    items = (await readDecisions(tmp)).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.chosen).toBe("b/Solo");
  });
});

describe("chooseDecision: mapping", () => {
  const MAP = { kind: "variant", "variant=primary": "variant=default" };

  it("mapping을 기록에 싣는다", async () => {
    const rec = await chooseDecision(tmp, index, "Solo", "a/Solo", { mapping: MAP });
    expect(rec.mapping).toEqual(MAP);
    expect((await readDecisions(tmp)).items[0]?.mapping).toEqual(MAP);
  });

  it("mapping을 안 주면 필드가 없다", async () => {
    const rec = await chooseDecision(tmp, index, "Solo", "a/Solo");
    expect(rec).not.toHaveProperty("mapping");
  });

  it("같은 선택·같은 메모·같은 mapping이면 파일이 바이트 동일하다(키 순서가 달라도)", async () => {
    await chooseDecision(tmp, index, "Solo", "a/Solo", { mapping: MAP, now: new Date("2026-11-01T00:00:00Z") });
    const before = decisionsText();
    const reordered = { "variant=primary": "variant=default", kind: "variant" };
    await chooseDecision(tmp, index, "Solo", "a/Solo", { mapping: reordered, now: new Date("2030-01-01T00:00:00Z") });
    expect(decisionsText()).toBe(before);
  });

  it("mapping이 달라지면 갱신하고, 없애면 필드가 사라진다", async () => {
    await chooseDecision(tmp, index, "Solo", "a/Solo", { mapping: MAP });
    await chooseDecision(tmp, index, "Solo", "a/Solo", { mapping: { kind: "tone" } });
    expect((await readDecisions(tmp)).items[0]?.mapping).toEqual({ kind: "tone" });
    await chooseDecision(tmp, index, "Solo", "a/Solo");
    expect((await readDecisions(tmp)).items[0]).not.toHaveProperty("mapping");
  });

  it.each([
    [{ "": "a" }, /빈/],
    [{ a: "" }, /빈/],
    [{ "a=b=c": "d" }, /"="/],
    [{ "a=b": "c" }, /prop=value/],
    [{ a: "b=c" }, /prop=value/],
  ])("형식 위반 %j 는 Error이고 파일을 만들지 않는다", async (mapping, message) => {
    await expect(chooseDecision(tmp, index, "Solo", "a/Solo", { mapping })).rejects.toThrow(message);
    expect(fs.existsSync(path.join(tmp, ".dsmith", "decisions.json"))).toBe(false);
  });
});
