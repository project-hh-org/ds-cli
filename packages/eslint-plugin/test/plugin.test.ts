import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Linter } from "eslint";
import { eligibleFindings, evaluateFile, extractComponentUsage, extractFileStyles, extractorMatchers, parseTsx, ruleContextOf } from "@dsmith-dev/core";
import plugin from "../src/index.js";
import { BUILTIN_EXTRACTORS } from "../src/registry.js";
import { createHash } from "node:crypto";
import { makeRoot, snapshotOf, writeSnapshot } from "./helpers.js";
import { guardSnapshotHash } from "../src/index.js";

const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf-8")) as { name: string; version: string };

describe("plugin", () => {
  it("meta는 package.json과 같다", () => {
    expect(plugin.meta).toEqual({ name: pkg.name, version: pkg.version });
  });

  it("규칙 3개와 recommended(files·plugins·rules)", () => {
    expect(Object.keys(plugin.rules).sort()).toEqual(["no-deprecated-component", "no-hardcoded-style", "prefer-ds-component"]);
    const r = plugin.configs.recommended;
    expect(r.name).toBe("dsmith/recommended");
    expect(r.files).toEqual(["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"]);
    expect(r.plugins?.["dsmith"]).toBe(plugin);
    expect(r.rules).toEqual({ "dsmith/no-hardcoded-style": "warn", "dsmith/prefer-ds-component": "warn", "dsmith/no-deprecated-component": "error" });
  });

  it("recommended.files에 CSS가 없다 — CSS는 guard --ci 경로", () => {
    const files = plugin.configs.recommended.files as string[];
    expect(files.join(" ")).not.toMatch(/css|scss/);
    const t = makeRoot("plugin-css", snapshotOf());
    const messages = new Linter({ configType: "flat", cwd: t.root }).verify(`.a { color: #3b82f6; }`, [plugin.configs.recommended], { filename: t.abs("src/a.css") });
    expect(messages.filter((m) => m.ruleId?.startsWith("dsmith/"))).toEqual([]);
  });

  it("recommended로 Linter 실행 — 경고 수 = evaluateFile의 치환 대상 finding 수(같은 엔진)", () => {
    const snapshot = snapshotOf({
      ds: { modules: ["components/ui"], components: [{ name: "Button", module: "components/ui/button" }, { name: "Dialog", module: "components/ui/dialog", deprecated: "Use Modal" }] },
    });
    const t = makeRoot("plugin-linter", snapshot);
    const code = [
      `import { Button } from "./legacy/Button";`,
      `import { Dialog } from "../components/ui/dialog";`,
      `export const A = () => (`,
      `  <div style={{ color: "#3b82f6", width: 10 }} className="bg-[#4286f5] p-[8px]">`,
      `    <Button /><Dialog />`,
      `  </div>`,
      `);`,
    ].join("\n");
    const file = "src/a.jsx";

    const linter = new Linter({ configType: "flat", cwd: t.root });
    const messages = linter.verify(
      code,
      [plugin.configs.recommended, { languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, settings: { dsmith: { guardFile: t.guardFile } } }],
      { filename: t.abs(file) },
    );

    const extractors = snapshot.extractors.map((n) => BUILTIN_EXTRACTORS[n]!);
    const usages = extractFileStyles({ root: t.root, file, code }, extractorMatchers(extractors, { dot: true })).styles;
    const components = extractComponentUsage(file, parseTsx(code, file), null, { baseUrlEntries: new Set(), dependencies: new Set(["react"]) });
    const expected = eligibleFindings(evaluateFile({ file, usages, components, ...ruleContextOf(snapshot) }));
    expect(expected.length).toBeGreaterThan(3);
    expect(messages.filter((m) => m.fatal)).toEqual([]);
    expect(messages).toHaveLength(expected.length);
    expect(messages.map((m) => m.ruleId).sort()).toEqual(expected.map((f) => `dsmith/${f.rule}`).sort());
    // 심각도: deprecated는 error(2), 나머지는 warn(1)
    for (const m of messages) expect(m.severity).toBe(m.ruleId === "dsmith/no-deprecated-component" ? 2 : 1);
  });
});

describe("recommended의 snapshotHash (eslint --cache 키)", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const hashAt = (cwd: string): unknown => {
    const prev = process.cwd();
    process.chdir(cwd);
    try {
      return (plugin.configs.recommended.settings as { dsmith: { snapshotHash: string } }).dsmith.snapshotHash;
    } finally {
      process.chdir(prev);
    }
  };

  it("guard.json 내용의 sha256이고, 파일이 바뀌면 달라진다", () => {
    const t = makeRoot("hash-change", snapshotOf());
    const before = hashAt(t.root);
    expect(before).toBe(sha(fs.readFileSync(t.guardFile, "utf-8")));
    writeSnapshot(t.guardFile, snapshotOf({ tokens: [] }));
    const after = hashAt(t.root);
    expect(after).toBe(sha(fs.readFileSync(t.guardFile, "utf-8")));
    expect(after).not.toBe(before);
  });

  it("하위 디렉터리에서도 위로 찾는다", () => {
    const t = makeRoot("hash-walk", snapshotOf());
    fs.mkdirSync(t.abs("src/deep"), { recursive: true });
    expect(hashAt(t.abs("src/deep"))).toBe(sha(fs.readFileSync(t.guardFile, "utf-8")));
  });

  it("파일이 없으면 none, 던지지 않는다 / 깨진 파일도 해시만 낸다", () => {
    const t = makeRoot("hash-none", null);
    expect(hashAt(t.root)).toBe("none");
    expect(guardSnapshotHash(path.join(t.root, "nope", "deeper"))).toBe("none");
    const broken = makeRoot("hash-broken", snapshotOf());
    writeSnapshot(broken.guardFile, "{nope");
    expect(hashAt(broken.root)).toBe(sha("{nope"));
  });

  it("접근할 때마다 새로 만든다", () => {
    const t = makeRoot("hash-fresh", snapshotOf());
    const a = plugin.configs.recommended;
    expect(plugin.configs.recommended).not.toBe(a);
    expect(a.plugins?.["dsmith"]).toBe(plugin);
    void t;
  });
});
