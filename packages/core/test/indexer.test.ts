import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inlineStyleExtractor } from "@ds-cli/extractor-inline-style";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("appliesTo가 false인 extractor는 호출하지 않고, include/exclude 옵션을 따른다", async () => {
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
    const index = await indexRepo(tmp, [never], { exclude: ["skip/**"] });
    expect(calls).toBe(0);
    expect(index.files.scanned).toBe(1);

    const only = await indexRepo(tmp, [never], { include: ["skip/**/*.tsx"], exclude: [] });
    expect(only.files.scanned).toBe(1);
  });
});
