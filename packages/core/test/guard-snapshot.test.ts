import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GUARD_POLICY } from "../src/rules/model.js";
import {
  GUARD_FILE,
  findGuardSnapshotSync,
  moduleContextOf,
  readGuardSnapshotSync,
  ruleContextOf,
  type GuardSnapshot,
} from "../src/guard/snapshot.js";
import { staleGuardTokenFiles, writeGuardSnapshot } from "../src/guard/write.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-guard-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const sha = (t: string): string => createHash("sha256").update(t).digest("hex");
const snap = (over: Partial<GuardSnapshot> = {}): GuardSnapshot => ({
  version: 1,
  dsmith: "0.1.0",
  extractors: ["inline-style"],
  tokens: [{ name: "--space-4", value: "16px", category: "spacing", normalized: { kind: "length", px: 16 }, path: "space.4" }],
  tokenSource: "token-file",
  tokenFiles: [],
  ds: { modules: ["src/ui"], components: [{ name: "Button", module: "src/ui/button" }] },
  preferred: [{ name: "Modal", module: "src/ui/modal" }],
  preset: null,
  exclude: ["**/node_modules/**"],
  moduleContext: { tsPaths: null, baseUrlEntries: ["src"], dependencies: ["react"] },
  policy: DEFAULT_GUARD_POLICY,
  ...over,
});

describe("guard snapshot", () => {
  it("write → readSync 왕복, 두 번 써도 바이트 동일", async () => {
    const file = await writeGuardSnapshot(root, snap());
    const first = fs.readFileSync(file, "utf-8");
    await writeGuardSnapshot(root, snap());
    expect(fs.readFileSync(file, "utf-8")).toBe(first);
    expect(first.endsWith("}\n")).toBe(true);
    expect(readGuardSnapshotSync(file)).toEqual(snap());
  });
  it("하위 디렉터리에서 위로 찾는다, 없으면 null", async () => {
    await writeGuardSnapshot(root, snap());
    const sub = path.join(root, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    const found = findGuardSnapshotSync(sub);
    expect(found?.root).toBe(root);
    expect(found?.file).toBe(path.join(root, GUARD_FILE));
    expect(findGuardSnapshotSync(path.join(os.tmpdir(), "dsmith-nonexistent-xyz"))).toBeNull();
  });
  it("깨진 JSON은 경로를 담은 Error", () => {
    const file = path.join(root, GUARD_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{nope");
    expect(() => readGuardSnapshotSync(file)).toThrow(file);
    fs.writeFileSync(file, JSON.stringify({ version: 1 }));
    expect(() => readGuardSnapshotSync(file)).toThrow(/extractors/);
  });
  it("policy 일부만 있으면 기본값으로 채운다", () => {
    const file = path.join(root, GUARD_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { policy: _p, ...rest } = snap();
    fs.writeFileSync(file, JSON.stringify({ ...rest, policy: { minConfidence: "exact", allow: { files: ["x/**"] } } }));
    expect(readGuardSnapshotSync(file).policy).toEqual({
      allow: { files: ["x/**"], properties: [] },
      minConfidence: "exact",
      failOn: { newHardcoded: 0, deprecated: 0 },
    });
  });
  it("배열·enum 검증은 경로를 담은 Error", () => {
    const file = path.join(root, GUARD_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const put = (o: unknown): void => fs.writeFileSync(file, JSON.stringify(o));
    put({ ...snap(), tokens: "x" });
    expect(() => readGuardSnapshotSync(file)).toThrow(file);
    put({ ...snap(), ds: { modules: [], components: "x" } });
    expect(() => readGuardSnapshotSync(file)).toThrow(/ds/);
    put({ ...snap(), policy: { minConfidence: "far" } });
    expect(() => readGuardSnapshotSync(file)).toThrow(/minConfidence/);
    put({ ...snap(), policy: { allow: { properties: ["colors"] } } });
    expect(() => readGuardSnapshotSync(file)).toThrow(/allow.properties/);
    put({ ...snap(), policy: { allow: { files: "a" } } });
    expect(() => readGuardSnapshotSync(file)).toThrow(/allow.files/);
    put({ ...snap(), version: 2 });
    expect(() => readGuardSnapshotSync(file)).toThrow(/dsmith guard init/);
  });
  it("ruleContextOf / moduleContextOf", () => {
    const s = snap();
    expect(ruleContextOf(s).tokens[0]).toMatchObject({ name: "--space-4", path: "space.4" });
    expect(moduleContextOf(s).baseUrlEntries?.has("src")).toBe(true);
    expect(moduleContextOf(s).dependencies?.has("react")).toBe(true);
  });
  it("토큰 파일 해시가 어긋나면 stale", async () => {
    fs.writeFileSync(path.join(root, "tokens.css"), ":root{--a:1px}");
    const s = snap({ tokenFiles: [{ file: "tokens.css", sha256: sha(":root{--a:1px}") }, { file: "gone.css", sha256: "x" }] });
    expect(await staleGuardTokenFiles(root, s)).toEqual(["gone.css"]);
    fs.writeFileSync(path.join(root, "tokens.css"), ":root{--a:2px}");
    expect(await staleGuardTokenFiles(root, s)).toEqual(["tokens.css", "gone.css"]);
  });
  it("동기 모듈(snapshot·rules)에 async 구문이 없다", () => {
    const src = path.resolve(import.meta.dirname, "../src");
    const files = ["guard/snapshot.ts", ...fs.readdirSync(path.join(src, "rules")).filter((n) => n.endsWith(".ts")).map((n) => `rules/${n}`)];
    for (const f of files) {
      const text = fs.readFileSync(path.join(src, f), "utf-8").replace(/\/\/.*$/gm, "");
      expect(text, f).not.toMatch(/\basync\b|\bawait\b|\bPromise\b|fs\/promises/);
    }
  });
});
