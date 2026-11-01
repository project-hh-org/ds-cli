import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFINITION_EXTENSIONS, resolveDefinitionFile } from "../src/component/definition.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-def-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(rel: string): void {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "export {};\n");
}

describe("resolveDefinitionFile", () => {
  it("module을 파일로 풀고(확장자 → index), 패키지는 null", async () => {
    write("src/a/Button.tsx");
    write("src/b/index.ts");
    expect(await resolveDefinitionFile(tmp, "src/a/Button")).toBe("src/a/Button.tsx");
    expect(await resolveDefinitionFile(tmp, "src/b")).toBe("src/b/index.ts");
    expect(await resolveDefinitionFile(tmp, "@mui/material")).toBeNull();
  });

  it("확장자 우선순위는 .tsx, .ts, .jsx, .js이고 파일이 index보다 먼저다", async () => {
    expect(DEFINITION_EXTENSIONS).toEqual([".tsx", ".ts", ".jsx", ".js"]);
    write("src/c.ts");
    write("src/c.js");
    write("src/c/index.tsx");
    expect(await resolveDefinitionFile(tmp, "src/c")).toBe("src/c.ts");
  });

  it("디렉터리는 파일로 보지 않고, 빈 module이나 root 탈출은 null이다", async () => {
    fs.mkdirSync(path.join(tmp, "src/d.tsx"), { recursive: true });
    expect(await resolveDefinitionFile(tmp, "src/d")).toBeNull();
    expect(await resolveDefinitionFile(tmp, "")).toBeNull();
    expect(await resolveDefinitionFile(tmp, "../outside")).toBeNull();
  });
});
