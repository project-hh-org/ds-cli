import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inlineStyleExtractor } from "@ds-cli/extractor-inline-style";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexRepo } from "../src/index/indexer.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-cli-"));
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
    expect(index.files.skipped[0]?.reason).toMatch(/^parse: /);

    expect(index.styles.map((s) => [s.file, s.property, s.raw]).sort()).toEqual([
      ["src/App.tsx", "padding", "8"],
      ["src/ui/Button.tsx", "color", "#ff0000"],
    ]);
    expect(index.components).toEqual([
      { file: "src/App.tsx", line: 2, name: "Button", importedFrom: "src/ui/Button", props: ["size", "style"] },
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
    const none = { name: "none", appliesTo: () => false, extract: () => [], write: () => null };
    const index = await indexRepo(tmp, [none], { exclude: ["skip/**"] });
    expect(index.files.scanned).toBe(1);
    expect(index.files.skipped).toEqual([]);

    const empty = await indexRepo(tmp, [none], { exclude: [] });
    expect(empty.files.scanned).toBe(2);
  });

  it(".next, build, coverage, .ds-cli 디렉터리는 기본으로 제외한다", async () => {
    put("src/a.tsx", `const a = <p />;`);
    put(".next/server/page.js", `const a = 1;`);
    put("build/out.js", `const a = 1;`);
    put("coverage/lcov.js", `const a = 1;`);
    put(".ds-cli/cache.js", `const a = 1;`);
    put("pkg/node_modules/x/index.js", `const a = 1;`);
    const seen: string[] = [];
    const spy = {
      name: "spy",
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
      appliesTo: () => true,
      extract: (ctx: { file: string }) => [usage(ctx.file)],
      write: () => null,
    };
    const second = {
      name: "second",
      appliesTo: () => true,
      extract: (ctx: { file: string }) => {
        if (ctx.file === "bad.tsx") throw new Error("boom");
        return [];
      },
      write: () => null,
    };
    const index = await indexRepo(tmp, [first, second]);
    expect(index.files.scanned).toBe(1);
    expect(index.files.skipped).toEqual([{ file: "bad.tsx", reason: "parse: boom" }]);
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
      const none = { name: "none", appliesTo: () => false, extract: () => [], write: () => null };
      const index = await indexRepo(tmp, [none]);
      expect(index.files.scanned).toBe(1);
      expect(index.files.skipped).toEqual([{ file: "a.tsx", reason: "read: EACCES: denied" }]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
