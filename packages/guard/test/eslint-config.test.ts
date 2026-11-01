import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseTsx, safeWrite, type PlannedWrite } from "@dsmith-dev/core";
import {
  CONFIG_BLOCK,
  ESLINT_CONFIG_MARKERS,
  ESLINT_IMPORT_MARKERS,
  IMPORT_BLOCK,
  eslintSnippet,
  planEslintConfig,
  type EslintPlan,
} from "../src/eslint-config.js";
import { cleanupTmps, makeRepo, read } from "./helpers.js";

afterEach(cleanupTmps);

const flat = (file: string) => ({ tool: "eslint" as const, configFile: file });

async function apply(root: string, file: string, plan: Extract<EslintPlan, { status: "insert" | "present" }>, force = false) {
  const abs = path.join(root, file);
  const writes: PlannedWrite[] = [
    { file: abs, region: { kind: "block", ...ESLINT_CONFIG_MARKERS, ...(plan.status === "insert" ? { insertAt: plan.configLine } : {}) }, content: CONFIG_BLOCK },
    { file: abs, region: { kind: "block", ...ESLINT_IMPORT_MARKERS, ...(plan.status === "insert" ? { insertAt: plan.importLine } : {}) }, content: IMPORT_BLOCK },
  ];
  return safeWrite(writes, {
    manifestFile: path.join(root, ".dsmith", "guard-init.json"),
    displayRoot: root,
    confineTo: root,
    tool: "guard",
    version: "0.1.0",
    force,
  });
}

function parseErrors(text: string, file: string): number {
  return (parseTsx(text, file).errors ?? []).length;
}

describe("planEslintConfig", () => {
  it("export default [ → insert, 적용 뒤 파싱 오류 0이고 dsmith 설정이 배열 첫 항목", async () => {
    const text = `export default [\n  js.configs.recommended,\n];\n`;
    const root = makeRepo({ "eslint.config.mjs": text });
    const plan = planEslintConfig(root, flat("eslint.config.mjs"), text);
    expect(plan).toEqual({ status: "insert", file: "eslint.config.mjs", importLine: 0, configLine: 1 });
    if (plan.status !== "insert") throw new Error("unreachable");
    const res = await apply(root, "eslint.config.mjs", plan);
    expect(res.outcomes.map((o) => o.status)).toEqual(["created", "created"]);
    const after = read(root, "eslint.config.mjs");
    expect(after).toBe(
      `${ESLINT_IMPORT_MARKERS.start}\n${IMPORT_BLOCK}\n${ESLINT_IMPORT_MARKERS.end}\nexport default [\n${ESLINT_CONFIG_MARKERS.start}\n${CONFIG_BLOCK}\n${ESLINT_CONFIG_MARKERS.end}\n  js.configs.recommended,\n];\n`,
    );
    expect(parseErrors(after, "eslint.config.mjs")).toBe(0);
    const ast = parseTsx(after, "eslint.config.mjs");
    const decl = ast.program.body.find((n) => n.type === "ExportDefaultDeclaration");
    if (decl?.type !== "ExportDefaultDeclaration" || decl.declaration.type !== "ArrayExpression") throw new Error("shape");
    const first = decl.declaration.elements[0];
    expect(first?.type).toBe("MemberExpression");
    expect(after.slice(first?.start ?? 0, first?.end ?? 0)).toBe("dsmith.configs.recommended");
  });

  it("기존 import 뒤에 import 블록을 넣는다", () => {
    const text = `import js from "@eslint/js";\nimport {\n  a,\n} from "x";\n\nexport default [\n  js.configs.recommended,\n];\n`;
    const plan = planEslintConfig("/r", flat("eslint.config.js"), text);
    expect(plan).toEqual({ status: "insert", file: "eslint.config.js", importLine: 4, configLine: 6 });
  });

  it.each([
    ["defineConfig([", `import { defineConfig } from "eslint/config";\nexport default defineConfig([\n  a,\n]);\n`, 1, 2],
    ["tseslint.config(", `import tseslint from "typescript-eslint";\nexport default tseslint.config(\n  a,\n);\n`, 1, 2],
  ])("%s 형태도 insert", async (_label, text, importLine, configLine) => {
    const root = makeRepo({ "eslint.config.mjs": text });
    const plan = planEslintConfig(root, flat("eslint.config.mjs"), text);
    expect(plan).toEqual({ status: "insert", file: "eslint.config.mjs", importLine, configLine });
    if (plan.status !== "insert") throw new Error("unreachable");
    await apply(root, "eslint.config.mjs", plan);
    const after = read(root, "eslint.config.mjs");
    expect(parseErrors(after, "eslint.config.mjs")).toBe(0);
    expect(after.indexOf("dsmith.configs.recommended")).toBeLessThan(after.indexOf("  a,"));
  });

  it("TypeScript 설정(eslint.config.ts)도 파싱한다", () => {
    const text = `import tseslint from "typescript-eslint";\nexport default tseslint.config(\n  { ignores: ["dist"] },\n);\n`;
    expect(planEslintConfig("/r", flat("eslint.config.ts"), text).status).toBe("insert");
  });

  it("한 줄 배열·변수로 내보냄·CJS는 unsupported-shape + snippet", () => {
    for (const [file, text] of [
      ["eslint.config.mjs", `export default [js.configs.recommended];\n`],
      ["eslint.config.mjs", `const config = [\n  a,\n];\nexport default config;\n`],
      ["eslint.config.js", `module.exports = [\n  a,\n];\n`],
      ["eslint.config.cjs", `module.exports = [\n  a,\n];\n`],
      ["eslint.config.mjs", `export default [ // flat\n  a,\n];\n`],
    ] as const) {
      const plan = planEslintConfig("/r", flat(file), text);
      expect(plan).toEqual({ status: "unsupported-shape", file, snippet: eslintSnippet() });
    }
    expect(eslintSnippet()).toBe(`${IMPORT_BLOCK}\ndsmith.configs.recommended,`);
  });

  it("파싱할 수 없는 설정은 unsupported-shape", () => {
    expect(planEslintConfig("/r", flat("eslint.config.mjs"), "export default [\n  {{{\n").status).toBe("unsupported-shape");
  });

  it(".eslintrc* → legacy, biome/oxlint → not-eslint, 도구 없음 → no-config", () => {
    expect(planEslintConfig("/r", flat(".eslintrc.json"), "{}")).toEqual({ status: "legacy", file: ".eslintrc.json", snippet: eslintSnippet() });
    expect(planEslintConfig("/r", { tool: "biome", configFile: "biome.json" }, null)).toEqual({ status: "not-eslint", tool: "biome" });
    expect(planEslintConfig("/r", { tool: "oxlint", configFile: ".oxlintrc.json" }, null)).toEqual({ status: "not-eslint", tool: "oxlint" });
    expect(planEslintConfig("/r", { tool: "none" }, null)).toEqual({ status: "no-config" });
  });

  it("마커가 이미 있으면 present, 두 번째 실행은 unchanged", async () => {
    const text = `export default [\n  js.configs.recommended,\n];\n`;
    const root = makeRepo({ "eslint.config.mjs": text });
    const first = planEslintConfig(root, flat("eslint.config.mjs"), text);
    if (first.status !== "insert") throw new Error("unreachable");
    await apply(root, "eslint.config.mjs", first);
    const second = planEslintConfig(root, flat("eslint.config.mjs"), read(root, "eslint.config.mjs"));
    expect(second).toEqual({ status: "present", file: "eslint.config.mjs" });
    if (second.status !== "present") throw new Error("unreachable");
    const before = read(root, "eslint.config.mjs");
    const res = await apply(root, "eslint.config.mjs", second);
    expect(res.outcomes.map((o) => o.status)).toEqual(["unchanged", "unchanged"]);
    expect(read(root, "eslint.config.mjs")).toBe(before);
  });

  it("사람이 블록을 고치면 skipped-modified, --force면 되돌린다", async () => {
    const text = `export default [\n  js.configs.recommended,\n];\n`;
    const root = makeRepo({ "eslint.config.mjs": text });
    const first = planEslintConfig(root, flat("eslint.config.mjs"), text);
    if (first.status !== "insert") throw new Error("unreachable");
    await apply(root, "eslint.config.mjs", first);
    const edited = read(root, "eslint.config.mjs").replace("  dsmith.configs.recommended,", "  [dsmith.configs.recommended][0],");
    fs.writeFileSync(path.join(root, "eslint.config.mjs"), edited);
    const present = planEslintConfig(root, flat("eslint.config.mjs"), edited);
    if (present.status !== "present") throw new Error("unreachable");
    const res = await apply(root, "eslint.config.mjs", present);
    expect(res.outcomes.map((o) => o.status)).toEqual(["skipped-modified", "unchanged"]);
    expect(read(root, "eslint.config.mjs")).toBe(edited);
    const forced = await apply(root, "eslint.config.mjs", present, true);
    expect(forced.outcomes[0]?.status).toBe("updated");
    expect(read(root, "eslint.config.mjs")).not.toContain("[0]");
  });
});

describe("planEslintConfig — 마커 한 쌍만 남은 설정", () => {
  const original = `import js from "@eslint/js";\n\nexport default [\n  js.configs.recommended,\n];\n`;
  const cfgBlock = new RegExp(`${ESLINT_CONFIG_MARKERS.start.replace(/[/*]/g, "\\$&")}[\\s\\S]*?${ESLINT_CONFIG_MARKERS.end.replace(/[/*]/g, "\\$&")}\\n`);
  const importBlock = new RegExp(`${ESLINT_IMPORT_MARKERS.start.replace(/[/*]/g, "\\$&")}[\\s\\S]*?${ESLINT_IMPORT_MARKERS.end.replace(/[/*]/g, "\\$&")}\\n`);

  async function installed(): Promise<string> {
    const root = makeRepo({ "eslint.config.mjs": original });
    const plan = planEslintConfig(root, flat("eslint.config.mjs"), original);
    if (plan.status !== "insert") throw new Error("unreachable");
    await apply(root, "eslint.config.mjs", plan);
    return root;
  }

  it("config 블록만 지워졌으면 insert — 배열 안에 다시 넣고 import 블록은 그대로", async () => {
    const root = await installed();
    const text = read(root, "eslint.config.mjs").replace(cfgBlock, "");
    expect(text).toContain(ESLINT_IMPORT_MARKERS.start);
    expect(text).not.toContain(ESLINT_CONFIG_MARKERS.start);
    fs.writeFileSync(path.join(root, "eslint.config.mjs"), text);
    const plan = planEslintConfig(root, flat("eslint.config.mjs"), text);
    expect(plan.status).toBe("insert");
    if (plan.status !== "insert") throw new Error("unreachable");
    const res = await apply(root, "eslint.config.mjs", plan);
    const after = read(root, "eslint.config.mjs");
    expect(res.outcomes.map((o) => o.status)).toEqual(["created", "unchanged"]);
    expect(parseErrors(after, "eslint.config.mjs")).toBe(0);
    expect(after.match(/dsmith\.configs\.recommended/g)).toHaveLength(1);
    expect(after.indexOf(ESLINT_CONFIG_MARKERS.start)).toBeLessThan(after.indexOf("];"));
    expect(after.match(/dsmith:import:start/g)).toHaveLength(1);
  });

  it("import 블록만 지워졌으면 insert — import 자리에 다시 넣고 config 블록은 그대로", async () => {
    const root = await installed();
    const text = read(root, "eslint.config.mjs").replace(importBlock, "");
    expect(text).not.toContain(ESLINT_IMPORT_MARKERS.start);
    fs.writeFileSync(path.join(root, "eslint.config.mjs"), text);
    const plan = planEslintConfig(root, flat("eslint.config.mjs"), text);
    expect(plan.status).toBe("insert");
    if (plan.status !== "insert") throw new Error("unreachable");
    const res = await apply(root, "eslint.config.mjs", plan);
    const after = read(root, "eslint.config.mjs");
    expect(res.outcomes.map((o) => o.status)).toEqual(["unchanged", "created"]);
    expect(parseErrors(after, "eslint.config.mjs")).toBe(0);
    expect(after.indexOf(ESLINT_IMPORT_MARKERS.start)).toBeLessThan(after.indexOf("export default"));
    expect(after.match(/@dsmith-dev\/eslint-plugin/g)).toHaveLength(1);
  });

  it("한 쌍만 있고 모양을 못 찾으면 unsupported-shape(파일을 건드리지 않음)", () => {
    const text = `${ESLINT_CONFIG_MARKERS.start}\n  dsmith.configs.recommended,\n${ESLINT_CONFIG_MARKERS.end}\nexport default [js.configs.recommended];\n`;
    expect(planEslintConfig("/r", flat("eslint.config.mjs"), text).status).toBe("unsupported-shape");
  });
});

describe("planEslintConfig — TS 파서 감지", () => {
  const plain = `import js from "@eslint/js";\n\nexport default [\n  js.configs.recommended,\n];\n`;
  const tsParser = { hasTsFiles: true, tsParserDep: false };

  it("TS 파일이 있는데 파서가 없으면 needs-ts-parser + snippet", () => {
    expect(planEslintConfig("/r", flat("eslint.config.mjs"), plain, tsParser)).toEqual({ status: "needs-ts-parser", file: "eslint.config.mjs", snippet: eslintSnippet() });
  });

  it.each([
    ["typescript-eslint", `import tseslint from "typescript-eslint";\nexport default [\n  tseslint.configs.base,\n];\n`],
    ["@typescript-eslint/parser", `import parser from "@typescript-eslint/parser";\nexport default [\n  { languageOptions: { parser } },\n];\n`],
    ["tseslint 식별자", `export default [\n  ...tseslint.configs.recommended,\n];\n`],
  ])("설정 텍스트에 %s가 있으면 insert", (_label, text) => {
    expect(planEslintConfig("/r", flat("eslint.config.mjs"), text, tsParser).status).toBe("insert");
  });

  it("루트 package.json에 typescript-eslint 의존성이 있으면 insert", () => {
    expect(planEslintConfig("/r", flat("eslint.config.mjs"), plain, { hasTsFiles: true, tsParserDep: true }).status).toBe("insert");
  });

  it("TS 파일이 없으면 파서가 없어도 insert", () => {
    expect(planEslintConfig("/r", flat("eslint.config.mjs"), plain, { hasTsFiles: false, tsParserDep: false }).status).toBe("insert");
  });
});
