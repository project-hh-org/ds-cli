import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StyleUsage } from "@dsmith-dev/core";
import { IGNORED, isKnownTokenRef, ratio, scoreRun, usageKey, type FileChange, type ScoreInput } from "../src/score.js";
import { PROBE, cleanupTmps, prepareDemoBase, type PreparedBase } from "./helpers.js";

let base: PreparedBase;
beforeAll(async () => {
  base = await prepareDemoBase();
}, 120_000);
afterAll(cleanupTmps);

const FILE = "src/components/Probe.tsx";
const added = (file: string, after: string): FileChange => ({ file, status: "added", before: null, after });
const modified = (file: string, before: string, after: string): FileChange => ({ file, status: "modified", before, after });
const run = (changes: FileChange[], expectedFile = FILE) => scoreRun({ root: base.root, snapshot: base.snapshot, matchers: base.matchers, changes, expectedFile } satisfies ScoreInput);
const only = (changes: FileChange[]) => {
  const r = run(changes);
  expect(r.files).toHaveLength(1);
  return r.files[0]!;
};

describe("베이스 스냅샷 (부록 D.4.2)", () => {
  it("토큰 14개, DS module 4개", () => {
    expect(base.snapshot.tokens).toHaveLength(14);
    expect(base.snapshot.ds.modules).toEqual([
      "design-system/components/Badge",
      "src/components/ui",
      "src/components/ui/button",
      "src/components/ui/dialog",
    ]);
  });
});

describe("프로브 파일 (부록 D.3)", () => {
  it("added: 지표가 프로브 숫자와 같다", () => {
    const r = run([added(FILE, PROBE)]);
    const f = r.files[0]!;
    expect(f).toMatchObject({ file: FILE, status: "added", parseFailed: false, nonDs: 0, deprecated: 0, dsComponentUses: 1 });
    expect(f.introduced).toEqual({ token: 4, knownToken: 4, hardcoded: 3, replaceable: 3, tailwindDefault: 2, dynamic: 0 });
    expect(r.totals).toMatchObject({ token: 4, knownToken: 4, hardcoded: 3, replaceable: 3, tailwindDefault: 2, nonDs: 0, dsComponentUses: 1, parseFailed: 0, files: 1 });
    expect(r.compliance).toBe(0.5714);
    expect(r.tokenShareAll).toBe(0.4444);
    expect(r.expectedFile).toBe(true);
    expect(r.excluded).toEqual([]);
    expect(r.ignored).toEqual([]);
    expect(r.deleted).toEqual([]);
  });

  it("text-[var(--made-up)]는 property other라 rated가 아니다", () => {
    const f = only([added(FILE, `export const A = () => <p className="text-[var(--made-up)]" />;\n`)]);
    expect(f.introduced).toEqual({ token: 0, knownToken: 0, hardcoded: 0, replaceable: 0, tailwindDefault: 0, dynamic: 0 });
  });

  it("지어낸 변수 배경 하나를 더하면 token +1, knownToken은 그대로", () => {
    const f = only([added(FILE, PROBE.replace('rounded-lg"', 'rounded-lg bg-[var(--made-up-color)]"'))]);
    expect(f.introduced.token).toBe(5);
    expect(f.introduced.knownToken).toBe(4);
  });
});

describe("수정 파일은 base 대비 다중집합 차", () => {
  const before = `export const A = () => <div style={{ color: "#111827", margin: 8 }} />;\n`;

  it("원래 있던 하드코딩 2개는 새로 센 것이 아니다", () => {
    const f = only([modified(FILE, before, before)]);
    expect(f.status).toBe("modified");
    expect(f.introduced.hardcoded).toBe(0);
  });

  it("하드코딩 1개와 토큰 1개를 더하면 hardcoded 1, token 1", () => {
    const after = `export const A = () => <div style={{ color: "#111827", margin: 8, backgroundColor: "#3b82f6", padding: "var(--space-4)" }} />;\n`;
    const f = only([modified(FILE, before, after)]);
    expect(f.introduced).toMatchObject({ hardcoded: 1, token: 1, knownToken: 1 });
  });

  it("기존 하드코딩을 지우면 음수 없이 0", () => {
    const after = `export const A = () => <div style={{ color: "#111827" }} />;\n`;
    const f = only([modified(FILE, before, after)]);
    expect(f.introduced).toMatchObject({ hardcoded: 0, replaceable: 0, token: 0 });
  });

  it("같은 값이 더 생기면 늘어난 만큼만 센다", () => {
    const after = `export const A = () => <div style={{ color: "#111827", margin: 8 }}><i style={{ color: "#111827" }} /></div>;\n`;
    expect(only([modified(FILE, before, after)]).introduced.hardcoded).toBe(1);
  });
});

describe("DS 외 컴포넌트", () => {
  it("로컬에서 Button을 선언하고 쓰면 nonDs 1 (DS에 Button 있음)", () => {
    const f = only([added(FILE, `function Button() {\n  return <button />;\n}\nexport const A = () => <Button />;\n`)]);
    expect(f.nonDs).toBe(1);
    expect(f.nonDsDetails).toHaveLength(1);
    expect(f.nonDsDetails[0]).toMatchObject({ name: "Button", preferModule: expect.stringContaining("src/components/ui") });
  });

  it("같은 이름의 비DS module에서 import하면 nonDs 1", () => {
    const f = only([added(FILE, `import { Button } from "@/components/Button";\nexport const A = () => <Button />;\n`)]);
    expect(f.nonDs).toBe(1);
    expect(f.nonDsDetails[0]).toMatchObject({ name: "Button", module: "src/components/Button" });
  });

  it("DS module에서 import하면 0이고 dsComponentUses로 센다", () => {
    const f = only([added(FILE, `import { Button } from "@/components/ui/button";\nexport const A = () => <Button />;\n`)]);
    expect(f.nonDs).toBe(0);
    expect(f.dsComponentUses).toBe(1);
  });
});

describe("분류", () => {
  it("excluded·ignored·deleted를 나눈다", () => {
    const r = run([
      added("design-system/tokens.css", ":root { --x: #fff; }\n"),
      added("AGENTS.md", "x"),
      added(".claude/x.md", "x"),
      added("README.md", "x"),
      added(".mcp.json", "{}"),
      { file: "src/old.tsx", status: "deleted", before: "x", after: null },
      added(FILE, PROBE),
    ]);
    expect(r.excluded).toEqual(["design-system/tokens.css"]);
    expect(r.ignored).toEqual([".claude/x.md", ".mcp.json", "AGENTS.md", "README.md"]);
    expect(r.deleted).toEqual(["src/old.tsx"]);
    expect(r.files.map((f) => f.file)).toEqual([FILE]);
  });

  it("IGNORED 목록은 계약과 같다", () => {
    expect([...IGNORED]).toEqual([".claude/**", ".dsmith/**", ".mcp.json", "AGENTS.md", "CLAUDE.md", ".codex/**", ".cursor/**", ".gemini/**", "node_modules/**", ".git/**"]);
  });

  it("expectedFile이 없으면 false", () => {
    expect(run([added("src/components/Other.tsx", PROBE)]).expectedFile).toBe(false);
    expect(run([added(FILE, PROBE)], "src/components/Other.tsx").expectedFile).toBe(false);
  });

  it("files는 file 순(code unit)으로 정렬된다", () => {
    const r = run([added("src/components/b.tsx", PROBE), added("src/components/B.tsx", PROBE), added("src/components/a.tsx", PROBE)]);
    expect(r.files.map((f) => f.file)).toEqual(["src/components/B.tsx", "src/components/a.tsx", "src/components/b.tsx"]);
  });

  it("구문이 깨진 .tsx는 던지지 않고 parseFailed true — 지표는 0이고 합계에서 빠지지만 파일 수에는 센다", () => {
    const broken = `export const A = () => <div className="a>;\n`;
    const r = run([added(FILE, broken), added("src/components/Ok.tsx", PROBE)]);
    const bad = r.files.find((f) => f.file === FILE)!;
    expect(bad.parseFailed).toBe(true);
    expect(bad.introduced).toEqual({ token: 0, knownToken: 0, hardcoded: 0, replaceable: 0, tailwindDefault: 0, dynamic: 0 });
    expect(bad.nonDs).toBe(0);
    expect(r.totals.parseFailed).toBe(1);
    expect(r.totals.files).toBe(2);
    expect(r.totals.hardcoded).toBe(3); // Ok.tsx만
    expect(r.expectedFile).toBe(true);
  });
});

describe("결정성과 보조 함수", () => {
  it("같은 입력 두 번 → JSON 동일", () => {
    const changes = [added(FILE, PROBE), modified("src/components/M.tsx", "export const M = 1;\n", `export const M = () => <i style={{ color: "#fff" }} />;\n`), added("AGENTS.md", "x")];
    expect(JSON.stringify(run(changes))).toBe(JSON.stringify(run(changes)));
  });

  it("ratio: 분모 0이면 null, 소수 4자리", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(4, 7)).toBe(0.5714);
    expect(ratio(1, 1)).toBe(1);
    expect(ratio(0, 3)).toBe(0);
  });

  it("usageKey: property|raw|source", () => {
    const u = { property: "padding", raw: "p-4", source: "tailwind-default" } as StyleUsage;
    expect(usageKey(u)).toBe("padding|p-4|tailwind-default");
  });

  it("isKnownTokenRef: var() 이름이 모두 토큰이거나 프리셋 키로 끝나야 한다", () => {
    const tokenName = base.snapshot.tokens[0]!.name;
    const mk = (raw: string): StyleUsage => ({ file: "a", line: 1, column: 0, property: "color", raw, normalized: { kind: "unknown" }, source: "token", extractor: "x" });
    expect(isKnownTokenRef(mk(`var(${tokenName})`), base.snapshot)).toBe(true);
    expect(isKnownTokenRef(mk(`bg-[color:var(${tokenName})]`), base.snapshot)).toBe(true);
    expect(isKnownTokenRef(mk(`var(${tokenName}, var(--made-up))`), base.snapshot)).toBe(false);
    expect(isKnownTokenRef(mk("var(--made-up)"), base.snapshot)).toBe(false);
    expect(isKnownTokenRef(mk("bg-ds-blue-400"), base.snapshot)).toBe(true);
    expect(isKnownTokenRef(mk("hover:!bg-ds-blue-400"), base.snapshot)).toBe(true);
    expect(isKnownTokenRef(mk("bg-ds-made-up"), base.snapshot)).toBe(false);
    expect(isKnownTokenRef(mk("bg-ds-blue-4000"), base.snapshot)).toBe(false);
  });
});
