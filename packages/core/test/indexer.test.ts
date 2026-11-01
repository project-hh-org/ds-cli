import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JS_FILES } from "@dsmith/extractor-api";
import { inlineStyleExtractor } from "@dsmith/extractor-inline-style";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexRepo } from "../src/index/indexer.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function put(rel: string, code: string) {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, code);
}

describe("indexRepo", () => {
  it("정상 파일은 scanned, 문법 오류 파일은 skipped(parse)로 기록하고 node_modules·dist는 건너뛴다", async () => {
    put("src/ui/Button.tsx", `export const Button = () => <button style={{ color: "#ff0000" }} />;`);
    put(
      "src/App.tsx",
      `import { Button } from "./ui/Button";\nexport const App = () => <Button size="sm" style={{ padding: 8 }} />;`,
    );
    put("src/Broken.tsx", `const a = <div style={{ color: "red" }}>;`);
    put("node_modules/pkg/index.tsx", `const a = <p style={{ color: "red" }} />;`);
    put("dist/out.js", `const a = 1;`);

    const index = await indexRepo(tmp, [inlineStyleExtractor]);

    expect(index.root).toBe(tmp);
    expect(Number.isNaN(Date.parse(index.createdAt))).toBe(false);
    expect(index.extractors).toEqual(["inline-style"]);
    expect(index.files.scanned).toBe(2);
    expect(index.files.skipped).toHaveLength(1);
    expect(index.files.skipped[0]?.file).toBe("src/Broken.tsx");
    expect(index.files.skipped[0]?.reason).toMatch(/^parse\(inline-style\): /);

    expect(index.styles.map((s) => [s.file, s.property, s.raw]).sort()).toEqual([
      ["src/App.tsx", "padding", "8"],
      ["src/ui/Button.tsx", "color", "#ff0000"],
    ]);
    expect(index.components).toEqual([
      {
        file: "src/App.tsx",
        line: 2,
        name: "Button",
        importedFrom: "src/ui/Button",
        module: "src/ui/Button",
        props: ["size", "style"],
      },
    ]);
  });

  it("root의 tsconfig paths를 읽어 컴포넌트 module 해석에 쓴다", async () => {
    put("tsconfig.json", `{ "compilerOptions": { "paths": { "components/*": ["./src/components/*"] } } }`);
    put("app/page.tsx", `import { Button } from "components/ui/button";\nexport const P = () => <Button />;`);
    const index = await indexRepo(tmp, [inlineStyleExtractor]);
    expect(index.components.map((c) => [c.importedFrom, c.module])).toEqual([
      ["components/ui/button", "src/components/ui/button"],
    ]);
  });

  it("extractor가 던진 usage 객체를 복제하지 않고 그대로 넘긴다(write용 WeakMap 키 보존)", async () => {
    put("a.tsx", `const a = <p />;`);
    const original = {
      file: "ignored",
      line: 1,
      column: 0,
      property: "color" as const,
      raw: "#fff",
      normalized: { kind: "unknown" as const },
      source: "hardcoded" as const,
      extractor: "fake",
    };
    const fake = {
      name: "fake",
      files: JS_FILES,
      parses: "none" as const,
      appliesTo: () => true,
      extract: () => [original],
      write: () => null,
    };
    const index = await indexRepo(tmp, [fake]);
    expect(index.styles[0]).toBe(original);
    expect(original.file).toBe("a.tsx");
  });

  it("appliesTo가 false인 extractor는 호출하지 않고, include 옵션은 기본 include를 대체한다", async () => {
    put("a.tsx", `const a = <p />;`);
    put("skip/b.tsx", `const b = <p />;`);
    let calls = 0;
    const never = {
      name: "never",
      files: JS_FILES,
      parses: "none" as const,
      appliesTo: () => false,
      extract: () => {
        calls += 1;
        return [];
      },
      write: () => null,
    };
    const all = await indexRepo(tmp, [never]);
    expect(all.files.scanned).toBe(2);
    expect(calls).toBe(0);

    const only = await indexRepo(tmp, [never], { include: ["skip/**/*.tsx"] });
    expect(only.files.scanned).toBe(1);
  });

  it("exclude 옵션은 기본 제외에 더해진다(대체하지 않는다)", async () => {
    put("a.tsx", `const a = <p />;`);
    put("skip/b.tsx", `const b = <p />;`);
    put("node_modules/pkg/c.tsx", `const c = <p />;`);
    const none = { name: "none", files: JS_FILES, parses: "none" as const, appliesTo: () => false, extract: () => [], write: () => null };
    const index = await indexRepo(tmp, [none], { exclude: ["skip/**"] });
    expect(index.files.scanned).toBe(1);
    expect(index.files.skipped).toEqual([]);

    const empty = await indexRepo(tmp, [none], { exclude: [] });
    expect(empty.files.scanned).toBe(2);
  });

  it(".next, build, coverage, .dsmith 디렉터리는 기본으로 제외한다", async () => {
    put("src/a.tsx", `const a = <p />;`);
    put(".next/server/page.js", `const a = 1;`);
    put("build/out.js", `const a = 1;`);
    put("coverage/lcov.js", `const a = 1;`);
    put(".dsmith/cache.js", `const a = 1;`);
    put("pkg/node_modules/x/index.js", `const a = 1;`);
    const seen: string[] = [];
    const spy = {
      name: "spy",
      files: JS_FILES,
      parses: "none" as const,
      appliesTo: (ctx: { file: string }) => {
        seen.push(ctx.file);
        return false;
      },
      extract: () => [],
      write: () => null,
    };
    const index = await indexRepo(tmp, [spy], { include: ["**/*.{tsx,jsx,ts,js}"], exclude: [] });
    expect(seen).toEqual(["src/a.tsx"]);
    expect(index.files.scanned).toBe(1);
  });

  it("한 파일의 extractor 하나라도 던지면 그 파일은 skipped이고 styles·components에 아무것도 남기지 않는다", async () => {
    put("bad.tsx", `import { B } from "./B"; const a = <B />;`);
    put("good.tsx", `import { G } from "./G"; const a = <G />;`);
    const usage = (file: string) => ({
      file,
      line: 1,
      column: 0,
      property: "color" as const,
      raw: "#fff",
      normalized: { kind: "unknown" as const },
      source: "hardcoded" as const,
      extractor: "first",
    });
    const first = {
      name: "first",
      files: JS_FILES,
      parses: "none" as const,
      appliesTo: () => true,
      extract: (ctx: { file: string }) => [usage(ctx.file)],
      write: () => null,
    };
    const second = {
      name: "second",
      files: JS_FILES,
      parses: "none" as const,
      appliesTo: () => true,
      extract: (ctx: { file: string }) => {
        if (ctx.file === "bad.tsx") throw new Error("boom");
        return [];
      },
      write: () => null,
    };
    const index = await indexRepo(tmp, [first, second]);
    expect(index.files.scanned).toBe(1);
    expect(index.files.skipped).toEqual([{ file: "bad.tsx", reason: "parse(second): boom" }]);
    expect(index.styles.map((s) => s.file)).toEqual(["good.tsx"]);
    expect(index.components.map((c) => c.file)).toEqual(["good.tsx"]);
  });

  it("읽기 실패는 reason이 read:로 시작하는 skipped로 기록하고 계속 진행한다", async () => {
    put("a.tsx", `const a = <p />;`);
    put("b.tsx", `const b = <p />;`);
    const original = fsp.readFile.bind(fsp);
    vi.spyOn(fsp, "readFile").mockImplementation(((p: unknown, ...rest: unknown[]) => {
      if (String(p).endsWith("a.tsx")) return Promise.reject(new Error("EACCES: denied"));
      return (original as (...args: unknown[]) => Promise<unknown>)(p, ...rest);
    }) as typeof fsp.readFile);
    try {
      const none = { name: "none", files: JS_FILES, parses: "none" as const, appliesTo: () => false, extract: () => [], write: () => null };
      const index = await indexRepo(tmp, [none]);
      expect(index.files.scanned).toBe(1);
      expect(index.files.skipped).toEqual([{ file: "a.tsx", reason: "read: EACCES: denied" }]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("indexRepo: Extractor 경계", () => {
  const usage = (file: string, extractor: string) => ({
    file,
    line: 1,
    column: 0,
    property: "color" as const,
    raw: "#fff",
    normalized: { kind: "unknown" as const },
    source: "hardcoded" as const,
    extractor,
  });

  it("Extractor가 선언한 글롭 합집합으로 파일을 모으고, JS/TS가 아닌 파일은 컴포넌트 파싱 없이 처리한다", async () => {
    put("notes.txt", `const a = <div>;`);
    put("a.tsx", `const a = <p />;`);
    const txt = {
      name: "txt",
      files: ["**/*.txt"],
      parses: "none" as const,
      appliesTo: () => true,
      extract: (ctx: { file: string }) => [usage(ctx.file, "txt")],
      write: () => null,
    };
    const index = await indexRepo(tmp, [txt]);
    expect(index.files.scanned).toBe(2);
    expect(index.files.skipped).toEqual([]);
    expect(index.styles.map((s) => s.file)).toEqual(["notes.txt"]);
    expect(index.components).toEqual([]);
  });

  it("prepare는 파일을 순회하기 전에 Extractor마다 정확히 1회 호출된다", async () => {
    put("a.tsx", `const a = <p />;`);
    put("b.tsx", `const b = <p />;`);
    const calls: string[] = [];
    const roots: string[] = [];
    const ext = {
      name: "prep",
      files: JS_FILES,
      parses: "none" as const,
      prepare: (root: string) => {
        calls.push("prepare");
        roots.push(root);
      },
      appliesTo: () => true,
      extract: () => {
        calls.push("extract");
        return [];
      },
      write: () => null,
    };
    await indexRepo(tmp, [ext]);
    expect(calls[0]).toBe("prepare");
    expect(calls.filter((c) => c === "prepare")).toHaveLength(1);
    expect(calls.filter((c) => c === "extract")).toHaveLength(2);
    expect(roots).toEqual([tmp]);
  });

  it("prepare가 실패하면 Extractor 이름을 붙여 indexRepo가 reject된다", async () => {
    put("a.tsx", `const a = <p />;`);
    const ext = {
      name: "prep-bad",
      files: JS_FILES,
      parses: "none" as const,
      prepare: () => {
        throw new Error("config missing");
      },
      appliesTo: () => true,
      extract: () => [],
      write: () => null,
    };
    await expect(indexRepo(tmp, [ext])).rejects.toThrow("prepare(prep-bad): config missing");
  });

  it("각 Extractor는 자기 files 글롭에 맞는 파일에만 호출된다", async () => {
    put("a.tsx", `const a = <p />;`);
    put("s.css", `.a { color: red; }`);
    const seen = { js: [] as string[], css: [] as string[] };
    const make = (name: "js" | "css", files: string[]) => ({
      name,
      files,
      parses: "none" as const,
      appliesTo: () => true,
      extract: (ctx: { file: string }) => {
        seen[name].push(ctx.file);
        return [usage(ctx.file, name)];
      },
      write: () => null,
    });
    const index = await indexRepo(tmp, [make("js", JS_FILES), make("css", ["**/*.css"])]);
    expect(seen.js).toEqual(["a.tsx"]);
    expect(seen.css).toEqual(["s.css"]);
    expect(index.files.scanned).toBe(2);
    expect(index.styles.map((s) => [s.file, s.extractor]).sort()).toEqual([
      ["a.tsx", "js"],
      ["s.css", "css"],
    ]);
  });

  it("같은 .tsx에 글롭이 겹치는 Extractor는 모두 적용된다", async () => {
    put("a.tsx", `const a = <p />;`);
    const make = (name: string) => ({
      name,
      files: JS_FILES,
      parses: "none" as const,
      appliesTo: () => true,
      extract: (ctx: { file: string }) => [usage(ctx.file, name)],
      write: () => null,
    });
    const index = await indexRepo(tmp, [make("one"), make("two")]);
    expect(index.styles.map((s) => s.extractor)).toEqual(["one", "two"]);
  });

  it("Extractor가 던지면 skip reason이 parse(<name>): 로 시작한다", async () => {
    put("a.tsx", `const a = <p />;`);
    const bad = {
      name: "bad",
      files: JS_FILES,
      parses: "none" as const,
      appliesTo: () => true,
      extract: () => {
        throw new Error("boom");
      },
      write: () => null,
    };
    const index = await indexRepo(tmp, [bad]);
    expect(index.files.scanned).toBe(0);
    expect(index.files.skipped).toEqual([{ file: "a.tsx", reason: "parse(bad): boom" }]);
  });

  it("JS/TS 파일의 컴포넌트 파싱 실패는 parse(components): 로 기록한다", async () => {
    put("Broken.tsx", `const a = <div>;`);
    const none = {
      name: "none",
      files: JS_FILES,
      parses: "none" as const,
      appliesTo: () => false,
      extract: () => [],
      write: () => null,
    };
    const index = await indexRepo(tmp, [none]);
    expect(index.files.skipped).toHaveLength(1);
    expect(index.files.skipped[0]?.reason).toMatch(/^parse\(components\): /);
  });

  it(".mjs·.cjs 파일도 기본 대상이다", async () => {
    put("a.mjs", `export const a = 1;`);
    put("b.cjs", `module.exports = 1;`);
    const none = {
      name: "none",
      files: JS_FILES,
      parses: "none" as const,
      appliesTo: () => false,
      extract: () => [],
      write: () => null,
    };
    const index = await indexRepo(tmp, [none]);
    expect(index.files.scanned).toBe(2);
  });
});
