import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Linter, type Rule } from "eslint";
import { analyze, type Analysis } from "../src/analyze.js";
import { BUILTIN_EXTRACTORS } from "../src/registry.js";
import { makeRoot, snapshotOf, writeSnapshot } from "./helpers.js";

const seen: (Analysis | null)[] = [];
const probe = (id: string): Rule.RuleModule => ({
  meta: { schema: [] },
  create: (context) => ({
    Program() {
      seen.push(analyze(context));
      void id;
    },
  }),
});
const spyPlugin = { rules: { a: probe("a"), b: probe("b") } };

function lint(code: string, t: { root: string; guardFile: string; abs: (f: string) => string }, file = "src/a.jsx") {
  seen.length = 0;
  const messages = new Linter({ configType: "flat", cwd: t.root }).verify(
    code,
    [
      {
        files: ["**/*.jsx"],
        plugins: { spy: spyPlugin },
        rules: { "spy/a": "warn", "spy/b": "warn" },
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        settings: { dsmith: { guardFile: t.guardFile } },
      },
    ],
    { filename: t.abs(file) },
  );
  return { messages, seen: [...seen] };
}

afterEach(() => vi.restoreAllMocks());

const CODE = `const A = () => <div style={{ color: "#3b82f6" }} />;`;

describe("analyze", () => {
  it("같은 파일에 규칙 둘 → 추출 1회, 같은 Analysis 객체", () => {
    const t = makeRoot("an-once", snapshotOf());
    const spy = vi.spyOn(BUILTIN_EXTRACTORS["inline-style"]!, "extract");
    const { seen: s } = lint(CODE, t);
    expect(s).toHaveLength(2);
    expect(s[0]).not.toBeNull();
    expect(s[1]).toBe(s[0]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(s[0]?.file).toBe("src/a.jsx");
    expect(s[0]?.root).toBe(t.root);
    expect(s[0]?.findings).toHaveLength(1);
  });

  it("스냅샷은 mtime이 같으면 재사용, 바뀌면 다시 읽는다", () => {
    const t = makeRoot("an-mtime", snapshotOf());
    writeSnapshot(t.guardFile, snapshotOf(), 1_700_000_000);
    const first = lint(CODE, t).seen[0]!;
    const again = lint(CODE, t).seen[0]!;
    expect(again.snapshot).toBe(first.snapshot);

    writeSnapshot(t.guardFile, snapshotOf({ tokens: [] }), 1_700_000_100);
    const changed = lint(CODE, t).seen[0]!;
    expect(changed.snapshot).not.toBe(first.snapshot);
    expect(changed.snapshot.tokens).toEqual([]);
    expect(changed.findings[0]?.style?.replacement).toBeNull();
  });

  it("깨진 스냅샷 → 보고 없음, 경고는 한 번만", () => {
    const t = makeRoot("an-broken", snapshotOf());
    writeSnapshot(t.guardFile, "{nope", 1_700_000_200);
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const a = lint(CODE, t);
    const b = lint(CODE, t);
    expect(a.seen).toEqual([null, null]);
    expect(b.seen).toEqual([null, null]);
    expect(a.messages).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("guard 스냅샷");
    // 고쳐 쓰면 다시 동작
    writeSnapshot(t.guardFile, snapshotOf(), 1_700_000_300);
    expect(lint(CODE, t).seen[0]).not.toBeNull();
  });

  it("스냅샷이 없으면 null, 경고 없음", () => {
    const t = makeRoot("an-none", null);
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    expect(lint(CODE, t).seen).toEqual([null, null]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("settings.dsmith.guardFile이 없으면 디렉터리에서 위로 찾는다", () => {
    const t = makeRoot("an-walk", snapshotOf());
    fs.mkdirSync(t.abs("src/deep"), { recursive: true });
    seen.length = 0;
    new Linter({ configType: "flat", cwd: t.root }).verify(
      CODE,
      [{ files: ["**/*.jsx"], plugins: { spy: spyPlugin }, rules: { "spy/a": "warn" }, languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }],
      { filename: t.abs("src/deep/a.jsx") },
    );
    expect(seen[0]?.file).toBe("src/deep/a.jsx");
  });

  it("allow.files에 맞는 파일은 추출하지 않는다(null)", () => {
    const t = makeRoot("an-allow", snapshotOf({ policy: { allow: { files: ["src/legacy/**"], properties: [] }, minConfidence: "close", failOn: { newHardcoded: 0, deprecated: 0 } } }));
    const spy = vi.spyOn(BUILTIN_EXTRACTORS["inline-style"]!, "extract");
    expect(lint(CODE, t, "src/legacy/a.jsx").seen[0]).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
