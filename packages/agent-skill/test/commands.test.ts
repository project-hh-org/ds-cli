import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { COMMANDS_DIR, loadCommands } from "../src/commands.js";

const EXPECTED = ["ds", "ds-ai", "ds-audit", "ds-check", "ds-decide", "ds-detect", "ds-init", "ds-migrate"];

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpCommands(files: Record<string, string>): URL {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-cmds-"));
  tmpDirs.push(dir);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return pathToFileURL(`${dir}/`);
}

const valid = (name: string, extra = "", body = "본문 한 줄"): string =>
  `---\nname: ${name}\ndescription: 설명 한 줄.\nuses: []\n${extra}---\n\n${body}\n`;

describe("loadCommands — 실제 명령 소스", () => {
  it("8개를 파일명 오름차순으로 읽는다", async () => {
    const commands = await loadCommands();
    expect(commands.map((c) => c.name)).toEqual(EXPECTED);
  });

  it("COMMANDS_DIR은 패키지 루트의 commands/를 가리킨다", () => {
    expect(COMMANDS_DIR.pathname.endsWith("/packages/agent-skill/commands/")).toBe(true);
  });

  it("각 본문은 40줄 이하이고 {{args}}는 최대 1회", async () => {
    for (const c of await loadCommands()) {
      expect(c.body.split("\n").length, c.name).toBeLessThanOrEqual(40);
      expect(c.body.split("{{args}}").length - 1, c.name).toBeLessThanOrEqual(1);
      expect(c.description.length, c.name).toBeGreaterThan(0);
      expect(c.description.length, c.name).toBeLessThanOrEqual(1024);
    }
  });

  it("3a에서 아직 없는 ds-init·ds-ai·ds-migrate는 uses가 비고 '아직 제공되지 않음'을 말한다", async () => {
    const commands = await loadCommands();
    for (const name of ["ds-init", "ds-ai", "ds-migrate"]) {
      const c = commands.find((x) => x.name === name);
      expect(c?.uses, name).toEqual([]);
      expect(c?.body, name).toContain("아직 제공되지 않음");
    }
  });

  it("ds-audit은 기준 형식(args·uses·cli:audit)을 따른다", async () => {
    const audit = (await loadCommands()).find((c) => c.name === "ds-audit");
    expect(audit?.args).toBe("[--root <dir>] [--exclude <glob>]");
    expect(audit?.uses).toEqual(["cli:audit"]);
    expect(audit?.body).toContain("npx dsmith audit --json {{args}}");
  });

  it("uses가 스펙대로 선언돼 있다", async () => {
    const byName = Object.fromEntries((await loadCommands()).map((c) => [c.name, c.uses]));
    expect(byName["ds"]).toEqual(["cli:detect"]);
    expect(byName["ds-detect"]).toEqual(["cli:detect"]);
    expect(byName["ds-decide"]).toEqual(["cli:decide --list", "mcp:list_decisions", "mcp:explain_decision"]);
    expect(byName["ds-check"]).toEqual(["mcp:lint_snippet", "mcp:resolve_token"]);
  });

  it("/ds는 detect.state 순서(0·1·2)와 사람 확인을 본문에 담는다", async () => {
    const ds = (await loadCommands()).find((c) => c.name === "ds");
    expect(ds?.body).toContain("state");
    expect(ds?.body).toMatch(/audit.*decide.*init.*ai/s);
    expect(ds?.body).toContain("0.3.0");
  });
});

describe("loadCommands — 검증", () => {
  it("name과 파일명이 다르면 파일명을 담은 Error", async () => {
    const dir = tmpCommands({ "ds-a.md": valid("ds-b") });
    await expect(loadCommands(dir)).rejects.toThrow(/ds-a\.md.*name/s);
  });

  it("name이 규칙(소문자·숫자·하이픈)을 어기면 Error", async () => {
    const dir = tmpCommands({ "Ds_A.md": valid("Ds_A") });
    await expect(loadCommands(dir)).rejects.toThrow(/Ds_A\.md/);
  });

  it("uses 항목이 형식을 어기면 Error (cli:Audit)", async () => {
    const dir = tmpCommands({
      "ds-a.md": "---\nname: ds-a\ndescription: 설명.\nuses: [\"cli:Audit\"]\n---\n\n본문\n",
    });
    await expect(loadCommands(dir)).rejects.toThrow(/ds-a\.md.*uses/s);
  });

  it("uses가 없으면 Error", async () => {
    const dir = tmpCommands({ "ds-a.md": "---\nname: ds-a\ndescription: 설명.\n---\n\n본문\n" });
    await expect(loadCommands(dir)).rejects.toThrow(/ds-a\.md.*uses/s);
  });

  it("description이 비었거나 1024자를 넘으면 Error", async () => {
    const empty = tmpCommands({ "ds-a.md": "---\nname: ds-a\ndescription: \"\"\nuses: []\n---\n\n본문\n" });
    await expect(loadCommands(empty)).rejects.toThrow(/ds-a\.md.*description/s);
    const long = tmpCommands({
      "ds-a.md": `---\nname: ds-a\ndescription: ${"가".repeat(1025)}\nuses: []\n---\n\n본문\n`,
    });
    await expect(loadCommands(long)).rejects.toThrow(/ds-a\.md.*description/s);
  });

  it("본문이 40줄을 넘으면 Error", async () => {
    const body = Array.from({ length: 41 }, (_, i) => `줄 ${i}`).join("\n");
    const dir = tmpCommands({ "ds-a.md": valid("ds-a", "", body) });
    await expect(loadCommands(dir)).rejects.toThrow(/ds-a\.md.*40/s);
  });

  it("{{args}}가 두 번이면 Error", async () => {
    const dir = tmpCommands({ "ds-a.md": valid("ds-a", "", "{{args}} 그리고 {{args}}") });
    await expect(loadCommands(dir)).rejects.toThrow(/ds-a\.md.*args/s);
  });

  it("frontmatter가 없으면 Error", async () => {
    const dir = tmpCommands({ "ds-a.md": "본문만 있음\n" });
    await expect(loadCommands(dir)).rejects.toThrow(/ds-a\.md.*frontmatter/s);
  });

  it(".md가 아닌 파일은 무시한다", async () => {
    const dir = tmpCommands({ "ds-a.md": valid("ds-a"), "notes.txt": "무시" });
    expect((await loadCommands(dir)).map((c) => c.name)).toEqual(["ds-a"]);
  });
});
