import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { COMMANDS_DIR, loadCommands } from "../src/commands.js";

const EXPECTED = ["ds", "ds-ai", "ds-audit", "ds-check", "ds-decide", "ds-detect", "ds-guard", "ds-init", "ds-migrate"];

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
  it("9개를 파일명 오름차순으로 읽는다", async () => {
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

  it("백틱 뒤에 공백을 두고 조사를 붙이지 않는다(`/ds-ai` 은 같은 오타)", async () => {
    for (const c of await loadCommands()) expect(c.body, c.name).not.toMatch(/`\s[은는이가을를]\s/);
  });

  it("어떤 명령도 '아직 제공되지 않음'을 말하지 않고 버전 번호를 약속하지 않는다", async () => {
    for (const c of await loadCommands()) {
      expect(c.body, c.name).not.toContain("아직 제공되지 않음");
      expect(c.body, c.name).not.toMatch(/\d+\.\d+\.\d+/);
    }
  });

  it("ds-migrate는 계획(--json)을 먼저 보이고 확인 뒤 --apply --branch로 적용한다", async () => {
    const c = (await loadCommands()).find((x) => x.name === "ds-migrate");
    expect(c?.uses).toEqual(["cli:migrate"]);
    expect(c?.args).toBe("[--files <glob> | --category <c>]");
    expect(c?.body).toContain("npx dsmith migrate --json {{args}}");
    expect(c?.body).toContain("1단계와 같은 인자로 `npx dsmith migrate --apply --branch ds/migrate-<날짜>`");
    expect(c?.body).toContain("npx dsmith migrate --revert <id>");
    expect(c?.body).toContain("PR은 dsmith가 열지 않으니 사람이 직접 연다");
    expect(c?.body).toContain("/ds-init");
    expect(c?.body).toContain("/ds-decide");
    expect(c?.body).toContain("`--close`");
    expect(c?.body).toContain("`plan.stale.changed > 0 || plan.stale.added > 0`");
    expect(c?.body).not.toContain("`plan.stale`이 있으면");
    // M5: JSON 값이 아닌 숫자(파일 수)는 말하지 않는다. 이름은 JSON 필드와 정확히 같아야 한다
    expect(c?.body).toContain("`plan.files.length`");
    expect(c?.body).not.toContain("파일 수 `files`");
    // I1: 토큰 스타일시트 안내
    expect(c?.body).toContain("`plan.tokens.loaded.css`");
    expect(c?.body).toContain("--with-tokens");
    // M5: 보류 사유를 전부 풀어 쓴다
    for (const reason of ["decision-pending", "mapping-missing", "mapping-conflict", "non-jsx-use", "spread-props", "export-unknown", "overlap", "rolled-back"]) {
      expect(c?.body, reason).toContain(`\`${reason}\``);
    }
    expect(c?.body).toContain("JSON에 없는 숫자는 말하지 않는다");
    expect(c?.body.match(/\{\{args\}\}/g)).toHaveLength(1);
  });

  it("ds-guard는 dry-run 미리보기를 먼저 부르고 확인 뒤 같은 인자로 실행한다", async () => {
    const c = (await loadCommands()).find((x) => x.name === "ds-guard");
    expect(c?.uses).toEqual(["cli:guard init --dry-run"]); // 폴백도 미리보기(쓰지 않음)여야 한다 (I4)
    expect(c?.args).toBe("[--ci github]");
    expect(c?.body).toContain("npx dsmith guard init --dry-run --json {{args}}");
    expect(c?.body).toContain("npx dsmith guard init --json");
    for (const status of ["legacy", "unsupported-shape", "needs-ts-parser"]) expect(c?.body, status).toContain(`\`${status}\``);
    expect(c?.body).toContain(".dsmith/guard.json");
    expect(c?.body).toContain("@dsmith-dev/eslint-plugin");
    expect(c?.body).toContain("guard --ci");
    expect(c?.body).toContain("JSON에 없는 숫자는 말하지 않는다");
  });

  it("ds-decide는 props 차이가 있으면 --map을 묻고 모르면 비워 둔다", async () => {
    const body = (await loadCommands()).find((x) => x.name === "ds-decide")?.body ?? "";
    expect(body).toContain("`differences`에 props 차이가 있으면 사람에게 대응을 묻고 `--map <from>:<to>`를 함께 넘긴다");
    expect(body).toContain("`prop=value:prop=value`");
    expect(body).toContain("대응을 모르면 비워 둔다 — migrate가 그 사용을 보류한다");
  });

  it("ds-init·ds-ai는 dry-run 미리보기를 먼저 부르고 같은 인자로 실제 실행을 안내한다", async () => {
    const commands = await loadCommands();
    const init = commands.find((c) => c.name === "ds-init");
    expect(init?.uses).toEqual(["cli:init --dry-run", "mcp:list_decisions"]);
    expect(init?.body).toContain("npx dsmith init --dry-run --json {{args}}");
    expect(init?.body).toContain("npx dsmith init --json");
    expect(init?.body).toContain("skipped-exists");
    expect(init?.body).toContain("`coverage.byConfidence`");
    expect(init?.body).not.toContain("migrate가 바꿀 수 있는 예상치");
    const ai = commands.find((c) => c.name === "ds-ai");
    expect(ai?.uses).toEqual(["cli:ai --dry-run"]);
    expect(ai?.body).toContain("npx dsmith ai --dry-run --json {{args}}");
    expect(ai?.body).toContain("npx dsmith ai --json");
    expect(ai?.body).toContain("npx dsmith install");
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
    expect(byName["ds-migrate"]).toEqual(["cli:migrate"]);
    expect(byName["ds-guard"]).toEqual(["cli:guard init --dry-run"]);
  });

  it("/ds는 detect.state 순서(0·1·2)와 사람 확인을 본문에 담는다", async () => {
    const ds = (await loadCommands()).find((c) => c.name === "ds");
    expect(ds?.body).toContain("state");
    expect(ds?.body).toMatch(/audit.*decide.*init.*ai/s);
    expect(ds?.body).not.toContain("아직 제공되지 않음");
    expect(ds?.body).toContain("사람이 확인한 뒤에만 적용한다");
    expect(ds?.body).not.toContain("`/ds-init`, `/ds-ai`, `/ds-migrate` 단계");
    expect(ds?.body).toContain("직접 입력해 달라고 하고 멈춘다");
  });

  it("/ds는 상태 1·2에서도 ai를 거치게 안내하고 40줄 이하다", async () => {
    const ds = (await loadCommands()).find((c) => c.name === "ds");
    const body = ds?.body ?? "";
    expect(body).toContain("- 0 (DS 없음): `/ds-audit` → `/ds-decide` → `/ds-init` → `/ds-ai` → `/ds-migrate` → `/ds-guard`");
    expect(body).toContain("- 1 (DS는 있으나 도입이 약함): `/ds-audit` → `/ds-decide` → `/ds-ai` → `/ds-migrate` → `/ds-guard`");
    expect(body).toContain("- 2 (DS 사용 중): `/ds-ai` → `/ds-check` → `/ds-guard`");
    expect(body.split("\n").length).toBeLessThanOrEqual(40);
  });

  it("/ds-init은 {{args}}를 한 번만 쓰고 4단계에서 --all 선택을 붙이게 한다", async () => {
    const init = (await loadCommands()).find((c) => c.name === "ds-init");
    expect(init?.body.match(/\{\{args\}\}/g)).toHaveLength(1);
    expect(init?.body).toContain("3단계에서 `--all`을 골랐으면 `--all`을 붙여");
  });

  it("/ds-audit은 중복이 없고 상태 0이면 /ds-init을 제안한다", async () => {
    const audit = (await loadCommands()).find((c) => c.name === "ds-audit");
    expect(audit?.body).toContain("없고 `detect.state`가 0이면 `/ds-init`");
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

  it("cli uses는 하위 명령 한 단계까지만 허용한다 (cli:guard init 가능, mcp:a b·cli:a b c 불가)", async () => {
    const withUses = (u: string): URL => tmpCommands({ "ds-a.md": `---\nname: ds-a\ndescription: 설명.\nuses: ["${u}"]\n---\n\n본문\n` });
    expect((await loadCommands(withUses("cli:guard init --dry-run")))[0]?.uses).toEqual(["cli:guard init --dry-run"]);
    await expect(loadCommands(withUses("mcp:lint snippet"))).rejects.toThrow(/ds-a\.md.*uses/s);
    await expect(loadCommands(withUses("cli:a b c"))).rejects.toThrow(/ds-a\.md.*uses/s);
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

  it("알 수 없는 frontmatter 키는 Error", async () => {
    const dir = tmpCommands({ "ds-a.md": valid("ds-a", "argument-hint: x\n") });
    await expect(loadCommands(dir)).rejects.toThrow(/ds-a\.md.*argument-hint/s);
  });

  it("args를 선언했는데 본문에 {{args}}가 없으면 Error", async () => {
    const dir = tmpCommands({ "ds-a.md": valid("ds-a", 'args: "[x]"\n') });
    await expect(loadCommands(dir)).rejects.toThrow(/ds-a\.md.*args/s);
  });

  it("본문에 {{args}}가 있는데 args를 선언하지 않았으면 Error", async () => {
    const dir = tmpCommands({ "ds-a.md": valid("ds-a", "", "실행 {{args}}") });
    await expect(loadCommands(dir)).rejects.toThrow(/ds-a\.md.*args/s);
  });

  it("args와 {{args}}가 짝이면 통과", async () => {
    const dir = tmpCommands({ "ds-a.md": valid("ds-a", 'args: "[x]"\n', "실행 {{args}}") });
    expect((await loadCommands(dir))[0]?.args).toBe("[x]");
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

describe("명령 본문 규칙", () => {
  it("MCP 목록·객체 응답을 쓰는 명령(ds-check, ds-decide)은 truncated/nextCursor 규칙을 담는다", async () => {
    const commands = await loadCommands();
    for (const name of ["ds-check", "ds-decide"]) {
      const body = commands.find((c) => c.name === name)?.body ?? "";
      expect(body, name).toContain("`truncated`가 true면 `nextCursor`를 `cursor`로 넘겨 이어 받는다");
      expect(body, name).toContain("`omitted`");
    }
  });

  it("ds-check는 변경·신규 파일을 둘 다 고르고 파일이 없으면 멈춘다", async () => {
    const body = (await loadCommands()).find((c) => c.name === "ds-check")?.body ?? "";
    expect(body).toContain("git diff --name-only HEAD");
    expect(body).toContain("git ls-files --others --exclude-standard");
    expect(body).toContain("검사할 파일이 없으면 그렇게 말하고 멈춘다");
  });

  it("ds-decide는 항목·옵션 id를 따옴표로 감싸고 대체 목록은 --status pending을 쓴다", async () => {
    const body = (await loadCommands()).find((c) => c.name === "ds-decide")?.body ?? "";
    expect(body).toContain('--item "<item>" --choose "<id>"');
    expect(body).toContain("decide --list --status pending --json");
  });

  it("args를 선언한 명령만 {{args}}를 갖는다", async () => {
    for (const c of await loadCommands()) {
      expect(c.body.includes("{{args}}"), c.name).toBe(c.args !== undefined);
    }
  });
});
