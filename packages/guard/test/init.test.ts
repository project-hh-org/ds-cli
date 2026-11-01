import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_GUARD_POLICY,
  listDecisions,
  loadReplacementTokens,
  readGuardSnapshotSync,
  readIndex,
  recordDecision,
  readDecisions,
  staleGuardTokenFiles,
  writeDecisions,
  type GuardSnapshot,
} from "@dsmith-dev/core";
import { runGuardInit, WORKFLOW_FILE, renderWorkflow, buildGuardSnapshot } from "../src/index.js";
import { ESLINT_CONFIG } from "./helpers.js";
import { cleanupTmps, cloneRepo, copyFixture, keep, preparedDemo, read, treeHash, audit, write } from "./helpers.js";
import type { DetectResult } from "@dsmith-dev/detect";

afterEach(cleanupTmps);
afterAll(() => fs.rmSync(prepared.root, { recursive: true, force: true }));

let prepared: { root: string; detect: DetectResult };
beforeAll(async () => {
  prepared = await preparedDemo();
  keep(prepared.root);
}, 120_000);

const fresh = (): string => cloneRepo(prepared.root);
const options = (root: string) => ({ root, version: "0.1.0", detect: prepared.detect });

describe("buildGuardSnapshot / guard.json", () => {
  it("두 번 실행하면 바이트가 같고 키 순서가 고정이다", async () => {
    const root = fresh();
    await runGuardInit(options(root));
    const first = read(root, ".dsmith/guard.json");
    await runGuardInit(options(root));
    expect(read(root, ".dsmith/guard.json")).toBe(first);
    expect(Object.keys(JSON.parse(first))).toEqual([
      "version", "dsmith", "extractors", "tokens", "tokenSource", "tokenFiles", "ds", "preferred", "preset", "exclude", "moduleContext", "policy",
    ]);
    expect(first).not.toContain(root);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  it("tokens 수는 loadReplacementTokens, tokenFiles 해시는 최신, 읽기·검증 통과", async () => {
    const root = fresh();
    const res = await runGuardInit(options(root));
    const snap = readGuardSnapshotSync(path.join(root, ".dsmith/guard.json"));
    const rt = await loadReplacementTokens(root, prepared.detect.ds.tokenFiles);
    expect(rt.tokens.length).toBeGreaterThan(0);
    expect(snap.tokens).toHaveLength(rt.tokens.length);
    expect(res.counts.tokens).toBe(rt.tokens.length);
    expect(snap.tokenSource).toBe(rt.source);
    expect(snap.tokenFiles.map((t) => t.file)).toEqual(expect.arrayContaining([...rt.files]));
    expect(snap.tokenFiles.map((t) => t.file)).toEqual(expect.arrayContaining(["tailwind.config.ts"]));
    expect(snap.tokenFiles.map((t) => t.file)).toEqual([...snap.tokenFiles.map((t) => t.file)].sort());
    expect(await staleGuardTokenFiles(root, snap)).toEqual([]);
    expect(snap.extractors).toEqual(prepared.detect.activeExtractors);
    expect(snap.policy).toEqual(DEFAULT_GUARD_POLICY);
    // init 산출 디렉터리와 기본 제외가 exclude에 들어간다
    expect(snap.exclude).toEqual(expect.arrayContaining(["**/node_modules/**", "design-system/**"]));
  });

  it("preferred = decided duplicate 수, stale·pending·다른 종류는 뺀다", async () => {
    const root = fresh();
    const index = (await readIndex(root))!;
    const decisions = await readDecisions(root);
    const items = listDecisions(index, decisions).filter((i) => i.kind === "duplicate");
    expect(items.length).toBeGreaterThan(0);
    const [a, b] = items;
    let file = decisions;
    for (const it of [a, b]) {
      if (it === undefined) continue;
      file = recordDecision(file, { item: it.item, kind: "duplicate", status: "decided", options: it.options, chosen: it.options[0] ?? "", decidedAt: "2026-11-01T00:00:00.000Z" });
    }
    // 하나는 pending 기록, 하나는 token-cluster
    file = recordDecision(file, { item: "ghost", kind: "duplicate", status: "pending", options: ["x", "y"] });
    file = recordDecision(file, { item: "#3c83f7", kind: "token-cluster", status: "decided", options: ["#3c83f7"], chosen: "#3c83f7" });
    await writeDecisions(root, file);
    const decided = listDecisions(index, file, "decided").filter((i) => i.kind === "duplicate" && i.stale !== true);
    const res = await runGuardInit(options(root));
    const snap = readGuardSnapshotSync(path.join(root, ".dsmith/guard.json"));
    expect(res.counts.preferred).toBe(decided.length);
    expect(snap.preferred).toHaveLength(decided.length);
    expect(snap.preferred.every((p) => p.module !== "" && p.name !== "ghost")).toBe(true);
  });

  it("사람이 고친 policy는 유지한다", async () => {
    const root = fresh();
    await runGuardInit(options(root));
    const file = path.join(root, ".dsmith/guard.json");
    const edited = JSON.parse(fs.readFileSync(file, "utf-8")) as GuardSnapshot;
    edited.policy.failOn.newHardcoded = 5;
    edited.policy.allow.files = ["legacy/**"];
    fs.writeFileSync(file, `${JSON.stringify(edited, null, 2)}\n`);
    await runGuardInit(options(root));
    const snap = readGuardSnapshotSync(file);
    expect(snap.policy.failOn.newHardcoded).toBe(5);
    expect(snap.policy.allow.files).toEqual(["legacy/**"]);
  });

  it("깨진 기존 스냅샷은 무시하고 notes에 알린다", async () => {
    const root = fresh();
    write(root, ".dsmith/guard.json", "{ not json");
    const res = await runGuardInit(options(root));
    expect(res.notes.some((n) => n.includes("읽을 수 없어"))).toBe(true);
    expect(() => readGuardSnapshotSync(path.join(root, ".dsmith/guard.json"))).not.toThrow();
  });

  it("buildGuardSnapshot은 쓰지 않는다", async () => {
    const root = fresh();
    const before = treeHash(root, { includeDsmith: true });
    await buildGuardSnapshot({ root, detect: prepared.detect, version: "0.1.0", existing: null });
    expect(treeHash(root, { includeDsmith: true })).toBe(before);
  });
});

describe("runGuardInit", () => {
  it("eslint 설정에 블록 2개와 package.json devDependency, 워크플로(--ci github)", async () => {
    const root = fresh();
    const res = await runGuardInit({ ...options(root), ci: "github" });
    expect(res.eslint).toBe("insert");
    expect(res.eslintFile).toBe("eslint.config.mjs");
    expect(res.outcomes.map((o) => `${o.region}:${o.status}`)).toEqual(["block:created", "block:created", "json-key:created", "file:created"]);
    const cfg = read(root, "eslint.config.mjs");
    expect(cfg.indexOf("dsmith:import:start")).toBeLessThan(cfg.indexOf("export default ["));
    expect(cfg).toContain("export default [\n/* dsmith:start */\n  dsmith.configs.recommended,\n/* dsmith:end */\n  js.configs.recommended,");
    expect(JSON.parse(read(root, "package.json")).devDependencies["@dsmith-dev/eslint-plugin"]).toBe("^0.1.0");
    expect(res.workflow).toBe(WORKFLOW_FILE);
    expect(read(root, WORKFLOW_FILE)).toBe(renderWorkflow("0.1.0"));
    expect(res.notes).toEqual(
      expect.arrayContaining([
        ".dsmith/guard.json을 커밋해야 CI·ESLint가 같은 기준을 씁니다",
        "패키지 매니저로 설치하세요(예: pnpm install)",
      ]),
    );
    const manifest = JSON.parse(read(root, ".dsmith/guard-init.json")) as { tool: string };
    expect(manifest.tool).toBe("guard");
  });

  it("워크플로: 템플릿 그대로, 탭 없음, 버전 고정, 최소 권한", () => {
    const yml = renderWorkflow("1.2.3");
    expect(yml).not.toContain("\t");
    expect(yml).toContain('npx --yes dsmith@1.2.3 guard --ci --base "origin/${{ github.base_ref }}" --comment');
    expect(yml).toContain("permissions:\n  contents: read\n  pull-requests: write");
    expect(yml).toContain("fetch-depth: 0");
    expect(yml).toContain("actions/checkout@v4");
    expect(yml).toContain("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(yml.startsWith("# dsmith guard init이 생성한 파일입니다.")).toBe(true);
    expect(yml.endsWith("\n")).toBe(true);
  });

  it("두 번째 실행은 전부 unchanged이고 트리가 그대로", async () => {
    const root = fresh();
    await runGuardInit({ ...options(root), ci: "github" });
    const before = treeHash(root, { includeDsmith: true });
    const again = await runGuardInit({ ...options(root), ci: "github" });
    expect(again.eslint).toBe("present");
    expect(again.outcomes.map((o) => o.status)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged"]);
    expect(treeHash(root, { includeDsmith: true })).toBe(before);
    expect(again.notes).not.toContain("패키지 매니저로 설치하세요(예: pnpm install)");
  });

  it("사람이 고친 워크플로·eslint 블록은 --force 없이 덮어쓰지 않는다", async () => {
    const root = fresh();
    await runGuardInit({ ...options(root), ci: "github" });
    write(root, WORKFLOW_FILE, `${read(root, WORKFLOW_FILE)}# 내가 추가\n`);
    write(root, "eslint.config.mjs", read(root, "eslint.config.mjs").replace("  dsmith.configs.recommended,", "  dsmith.configs.recommended, // 손댐"));
    const again = await runGuardInit({ ...options(root), ci: "github" });
    expect(again.outcomes.map((o) => o.status)).toEqual(["skipped-modified", "unchanged", "unchanged", "skipped-modified"]);
    expect(read(root, WORKFLOW_FILE)).toContain("# 내가 추가");
    const forced = await runGuardInit({ ...options(root), ci: "github", force: true });
    expect(forced.outcomes.map((o) => o.status)).toEqual(["updated", "unchanged", "unchanged", "updated"]);
    expect(read(root, WORKFLOW_FILE)).toBe(renderWorkflow("0.1.0"));
  });

  it("--dry-run은 .dsmith 포함 트리를 바꾸지 않는다", async () => {
    const root = fresh();
    const before = treeHash(root, { includeDsmith: true });
    const res = await runGuardInit({ ...options(root), ci: "github", dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.outcomes.every((o) => o.status === "created" && o.diff !== undefined)).toBe(true);
    expect(treeHash(root, { includeDsmith: true })).toBe(before);
    expect(fs.existsSync(path.join(root, ".dsmith/guard.json"))).toBe(false);
  });

  it("guard.json은 마지막에 쓴다 — 쓰기 계층이 예외로 끝나면 만들어지지 않는다", async () => {
    const root = fresh();
    fs.mkdirSync(path.join(root, ".dsmith/guard-init.json"), { recursive: true }); // 매니페스트를 읽을 수 없게 만든다
    await expect(runGuardInit(options(root))).rejects.toThrow();
    expect(fs.existsSync(path.join(root, ".dsmith/guard.json"))).toBe(false);
  });

  it("legacy(.eslintrc)·biome·설정 없음은 파일을 건드리지 않고 안내만", async () => {
    const legacy = copyFixture("examples/legacy-demo", { ".eslintrc.json": "{}\n" });
    await audit(legacy);
    const d1 = await audit(legacy);
    const r1 = await runGuardInit({ root: legacy, version: "0.1.0", detect: d1 });
    expect(r1.eslint).toBe("legacy");
    expect(r1.snippet).toContain("dsmith.configs.recommended");
    expect(r1.outcomes).toEqual([]);
    expect(read(legacy, ".eslintrc.json")).toBe("{}\n");

    const biome = copyFixture("examples/legacy-demo", { "biome.json": "{}\n" });
    const r2 = await runGuardInit({ root: biome, version: "0.1.0", detect: await audit(biome) });
    expect(r2.eslint).toBe("not-eslint");
    expect(r2.notes).toContain("guard의 즉시 검사는 ESLint 전용 — CI 검사(guard --ci)는 그대로 쓸 수 있음");

    const none = copyFixture("examples/legacy-demo");
    const r3 = await runGuardInit({ root: none, version: "0.1.0", detect: await audit(none) });
    expect(r3.eslint).toBe("no-config");
    expect(fs.existsSync(path.join(none, ".dsmith/guard.json"))).toBe(true);
  });

  it("지원하지 않는 모양은 snippet만 돌려주고 설정은 그대로", async () => {
    const root = copyFixture("examples/legacy-demo", { "eslint.config.mjs": "export default [js.configs.recommended];\n" });
    const res = await runGuardInit({ root, version: "0.1.0", detect: await audit(root) });
    expect(res.eslint).toBe("unsupported-shape");
    expect(res.snippet).toContain('import dsmith from "@dsmith-dev/eslint-plugin";');
    expect(read(root, "eslint.config.mjs")).toBe("export default [js.configs.recommended];\n");
    expect(JSON.parse(read(root, "package.json")).devDependencies?.["@dsmith-dev/eslint-plugin"]).toBeUndefined();
    void ESLINT_CONFIG;
  });
});

describe("guard init notes", () => {
  it("ESLint는 JS/TS만, guard.json 없음/깨짐은 조용히 통과, --cache 안내", async () => {
    const root = cloneRepo(prepared.root);
    const res = await runGuardInit(options(root));
    expect(res.notes).toEqual(
      expect.arrayContaining([
        "ESLint 규칙은 JS/TS만 검사합니다. CSS·SCSS는 guard --ci가 검사합니다",
        ".dsmith/guard.json이 없거나 깨지면 ESLint 규칙은 조용히 통과합니다",
        "eslint --cache를 쓰면 .dsmith/guard.json을 바꾼 뒤 첫 실행은 캐시 없이(--no-cache) 돌리세요",
      ]),
    );
  });

  it("Tailwind 프리셋 파일이 나중에 바뀌면 stale", async () => {
    const root = cloneRepo(prepared.root);
    await runGuardInit(options(root));
    const snap = readGuardSnapshotSync(path.join(root, ".dsmith/guard.json"));
    fs.appendFileSync(path.join(root, "tailwind.config.ts"), "\n// 프리셋 연결\n");
    expect(await staleGuardTokenFiles(root, snap)).toEqual(["tailwind.config.ts"]);
  });
});
