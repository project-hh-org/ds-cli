import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runAiCommand } from "../src/commands/ai.js";
import { runAudit } from "../src/commands/audit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "../dist/bin.js");
const repo = path.resolve(here, "../../..");

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

async function auditedDsApp(): Promise<string> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-cli-ai-")));
  roots.push(root);
  fs.cpSync(path.join(repo, "fixtures", "with-ds-app"), root, {
    recursive: true,
    filter: (p) => !p.split(path.sep).includes(".dsmith"),
  });
  await runAudit(root, { exclude: [] });
  return root;
}

describe("dsmith ai", () => {
  it("runAiCommand: 카탈로그와 AGENTS.md DS 섹션을 만든다", async () => {
    const root = await auditedDsApp();
    const r = await runAiCommand({ root, version: "0.0.0-test" });
    expect(r.components).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8")).toContain("<!-- dsmith:ds:start -->");
  });

  it("--json 출력 = AiResult", async () => {
    const root = await auditedDsApp();
    const out = execFileSync("node", [bin, "ai", "--root", root, "--json"], { encoding: "utf-8" });
    const json = JSON.parse(out);
    expect(Object.keys(json).sort()).toEqual(
      [
        "catalogChanged", "catalogFile", "components", "deprecated", "dryRun", "manifest", "notes",
        "outcomes", "propsExtracted", "sources", "tokens", "warnings",
      ].sort(),
    );
    expect(json.catalogFile).toBe(".dsmith/catalog.json");
    expect(json.manifest).toBe(".dsmith/ai.json");
    expect(json.sources[0].origin).toBe("ds-local");
  });

  it("--dry-run은 쓰지 않고, 잘못된 --from은 오류", async () => {
    const root = await auditedDsApp();
    const out = execFileSync("node", [bin, "ai", "--root", root, "--dry-run"], { encoding: "utf-8" });
    expect(out).toContain("dry-run");
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".dsmith", "catalog.json"))).toBe(false);
    expect(() => execFileSync("node", [bin, "ai", "--root", root, "--from", "x"], { encoding: "utf-8", stdio: "pipe" })).toThrow();
  });
});

describe("dsmith ai: 상대 --root", () => {
  it("cwd 기준 상대 경로를 --root로 줘도 동작한다(safeWrite는 절대 경로를 요구)", async () => {
    const root = await auditedDsApp();
    const out = execFileSync("node", [bin, "ai", "--root", path.basename(root), "--json"], {
      encoding: "utf-8",
      cwd: path.dirname(root),
    });
    expect(JSON.parse(out).outcomes[0].status).toBe("created");
    expect(fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8")).toContain("<!-- dsmith:ds:start -->");
    // runAiCommand도 상대 경로를 받는다
    const rel = path.relative(process.cwd(), root);
    const r = await runAiCommand({ root: rel, version: "0.0.0-test" });
    expect(r.outcomes[0]?.status).toBe("unchanged");
  });
});
