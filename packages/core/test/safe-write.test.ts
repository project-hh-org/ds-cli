import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  regionKey,
  safeWrite,
  type PlannedWrite,
  type SafeWriteOptions,
  type WriteManifest,
} from "../src/fs/safe-write.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-safe-write-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const p = (...segments: string[]): string => path.join(root, ...segments);
const read = (rel: string): string => fs.readFileSync(p(rel), "utf-8");

function opts(extra: Partial<SafeWriteOptions> = {}): SafeWriteOptions {
  return {
    manifestFile: p(".dsmith", "install.json"),
    displayRoot: root,
    confineTo: root,
    tool: "install",
    version: "0.1.0",
    ...extra,
  };
}

function manifest(): WriteManifest {
  return JSON.parse(read(".dsmith/install.json")) as WriteManifest;
}

/** 경로 + 내용으로 트리 전체를 해시한다. */
function treeHash(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const rel = path.relative(dir, full);
      if (fs.statSync(full).isDirectory()) {
        h.update(`D:${rel}\n`);
        walk(full);
      } else {
        h.update(`F:${rel}\n`);
        h.update(fs.readFileSync(full));
      }
    }
  };
  walk(dir);
  return h.digest("hex");
}

const fileWrite = (rel: string, content: string): PlannedWrite => ({
  file: p(rel),
  region: { kind: "file" },
  content,
});
const blockWrite = (rel: string, content: string): PlannedWrite => ({
  file: p(rel),
  region: { kind: "block", start: "<!-- dsmith:start -->", end: "<!-- dsmith:end -->" },
  content,
});
const jsonWrite = (rel: string, keyPath: string[], value: unknown): PlannedWrite => ({
  file: p(rel),
  region: { kind: "json-key", keyPath },
  content: JSON.stringify(value),
});

describe("regionKey", () => {
  it("파일은 상대 경로, 블록·JSON 키는 접미사가 붙는다", () => {
    const mf = p(".dsmith", "install.json");
    expect(regionKey(fileWrite(".claude/skills/ds/SKILL.md", "x"), mf)).toBe(".claude/skills/ds/SKILL.md");
    expect(regionKey(blockWrite("AGENTS.md", "x"), mf)).toBe("AGENTS.md#block:<!-- dsmith:start -->");
    expect(regionKey(jsonWrite(".mcp.json", ["mcpServers", "dsmith"], {}), mf)).toBe(
      `.mcp.json#json:${JSON.stringify(["mcpServers", "dsmith"])}`,
    );
  });

  it("기준은 매니페스트의 ../.. 이고, 기준 밖 파일은 절대 경로, keyPath 'a.b'와 'a','b'는 다른 키", () => {
    const mf = p("home", ".dsmith", "install.json");
    expect(regionKey(fileWrite("home/.codex/prompts/ds.md", "x"), mf)).toBe(".codex/prompts/ds.md");
    expect(regionKey(fileWrite("elsewhere/x.md", "x"), mf)).toBe(p("elsewhere", "x.md").split(path.sep).join("/"));
    expect(regionKey(jsonWrite("home/s.json", ["a.b"], 1), mf)).not.toBe(regionKey(jsonWrite("home/s.json", ["a", "b"], 1), mf));
  });
});

describe("safeWrite — file 영역", () => {
  it("없는 파일은 created, 매니페스트에 해시가 기록된다", async () => {
    const res = await safeWrite([fileWrite("a/SKILL.md", "hello")], opts());
    expect(res.outcomes).toEqual([{ file: "a/SKILL.md", key: "a/SKILL.md", region: "file", status: "created" }]);
    expect(res.applied).toBe(true);
    expect(res.manifestChanged).toBe(true);
    expect(read("a/SKILL.md")).toBe("hello\n");
    expect(manifest()).toEqual({
      version: 1,
      tool: "install",
      dsmith: "0.1.0",
      entries: { "a/SKILL.md": { sha256: sha("hello\n") } },
    });
  });

  it("두 번째 실행은 전부 unchanged이고 파일·매니페스트 바이트와 mtime이 그대로다", async () => {
    const writes = [fileWrite("a/SKILL.md", "hello"), fileWrite("b/SKILL.md", "world")];
    await safeWrite(writes, opts());
    const old = new Date(0);
    for (const f of ["a/SKILL.md", "b/SKILL.md", ".dsmith/install.json"]) fs.utimesSync(p(f), old, old);
    const before = treeHash(root);

    const res = await safeWrite(writes, opts());
    expect(res.outcomes.map((o) => o.status)).toEqual(["unchanged", "unchanged"]);
    expect(res.manifestChanged).toBe(false);
    expect(treeHash(root)).toBe(before);
    for (const f of ["a/SKILL.md", "b/SKILL.md", ".dsmith/install.json"]) {
      expect(fs.statSync(p(f)).mtimeMs).toBe(0);
    }
  });

  it("dsmith가 쓴 그대로인 파일은 내용이 바뀌면 updated", async () => {
    await safeWrite([fileWrite("a.md", "v1")], opts());
    const res = await safeWrite([fileWrite("a.md", "v2")], opts());
    expect(res.outcomes[0]?.status).toBe("updated");
    expect(res.outcomes[0]?.diff).toBeUndefined();
    expect(read("a.md")).toBe("v2\n");
    expect(manifest().entries["a.md"]).toEqual({ sha256: sha("v2\n") });
  });

  it("사용자가 한 줄 고친 파일은 skipped-modified, 내용 그대로 + diff 제공", async () => {
    await safeWrite([fileWrite("SKILL.md", "line1\nline2\nline3")], opts());
    fs.writeFileSync(p("SKILL.md"), "line1\nline2 (내가 고침)\nline3\n");
    const res = await safeWrite([fileWrite("SKILL.md", "line1\nline2\nline3\nline4")], opts());
    const out = res.outcomes[0];
    expect(out?.status).toBe("skipped-modified");
    expect(out?.reason).toBeTruthy();
    expect(out?.diff).toContain("-line2 (내가 고침)");
    expect(out?.diff).toContain("+line4");
    expect(read("SKILL.md")).toBe("line1\nline2 (내가 고침)\nline3\n");
    expect(res.manifestChanged).toBe(false);
  });

  it("skipped-modified도 force면 updated", async () => {
    await safeWrite([fileWrite("SKILL.md", "v1")], opts());
    fs.writeFileSync(p("SKILL.md"), "내 버전\n");
    const res = await safeWrite([fileWrite("SKILL.md", "v2")], opts({ force: true }));
    expect(res.outcomes[0]?.status).toBe("updated");
    expect(read("SKILL.md")).toBe("v2\n");
    expect(manifest().entries["SKILL.md"]).toEqual({ sha256: sha("v2\n") });
  });

  it("매니페스트에 없는 기존 파일(내용 다름)은 skipped-unowned, force면 updated", async () => {
    fs.writeFileSync(p("CLAUDE.md"), "기존\n");
    const res = await safeWrite([fileWrite("CLAUDE.md", "dsmith")], opts());
    expect(res.outcomes[0]?.status).toBe("skipped-unowned");
    expect(res.outcomes[0]?.diff).toContain("+dsmith");
    expect(read("CLAUDE.md")).toBe("기존\n");
    expect(fs.existsSync(p(".dsmith/install.json"))).toBe(false);

    const forced = await safeWrite([fileWrite("CLAUDE.md", "dsmith")], opts({ force: true }));
    expect(forced.outcomes[0]?.status).toBe("updated");
    expect(read("CLAUDE.md")).toBe("dsmith\n");
  });

  it("매니페스트에 없지만 내용이 이미 같으면 unchanged + 채택(등록)", async () => {
    fs.writeFileSync(p("a.md"), "same\n");
    const res = await safeWrite([fileWrite("a.md", "same")], opts());
    expect(res.outcomes[0]?.status).toBe("unchanged");
    expect(res.manifestChanged).toBe(true);
    expect(manifest().entries["a.md"]).toEqual({ sha256: sha("same\n") });
    const next = await safeWrite([fileWrite("a.md", "next")], opts());
    expect(next.outcomes[0]?.status).toBe("updated");
  });

  it("끝 개행은 하나로 정규화한다", async () => {
    await safeWrite([fileWrite("a.md", "x\n\n\n")], opts());
    expect(read("a.md")).toBe("x\n");
  });

  it("매니페스트 엔트리 키는 정렬되고 타임스탬프가 없다", async () => {
    await safeWrite([fileWrite("z.md", "1"), fileWrite("a.md", "2"), fileWrite("m.md", "3")], opts());
    const text = read(".dsmith/install.json");
    expect(Object.keys(JSON.parse(text).entries)).toEqual(["a.md", "m.md", "z.md"]);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("safeWrite — block 영역", () => {
  const S = "<!-- dsmith:start -->";
  const E = "<!-- dsmith:end -->";

  it("파일이 없으면 블록만 있는 파일을 만든다", async () => {
    const res = await safeWrite([blockWrite("AGENTS.md", "규칙")], opts());
    expect(res.outcomes[0]?.status).toBe("created");
    expect(read("AGENTS.md")).toBe(`${S}\n규칙\n${E}\n`);
  });

  it("기존 본문 뒤에 블록을 붙이고, 이후 갱신은 블록만 바꾼다(블록 밖 바이트 동일)", async () => {
    const head = "# 프로젝트\n\n내가 쓴 설명\n";
    fs.writeFileSync(p("AGENTS.md"), head);
    const created = await safeWrite([blockWrite("AGENTS.md", "v1")], opts());
    expect(created.outcomes[0]?.status).toBe("created");
    expect(read("AGENTS.md")).toBe(`${head}\n${S}\nv1\n${E}\n`);

    const tail = "\n## 뒤에 사용자가 추가\n";
    fs.appendFileSync(p("AGENTS.md"), tail);
    const updated = await safeWrite([blockWrite("AGENTS.md", "v2\n둘째 줄")], opts());
    expect(updated.outcomes[0]?.status).toBe("updated");
    expect(read("AGENTS.md")).toBe(`${head}\n${S}\nv2\n둘째 줄\n${E}\n${tail}`);
  });

  it("끝 개행이 없는 기존 파일에도 붙인다", async () => {
    fs.writeFileSync(p("AGENTS.md"), "본문");
    await safeWrite([blockWrite("AGENTS.md", "x")], opts());
    expect(read("AGENTS.md")).toBe(`본문\n\n${S}\nx\n${E}\n`);
  });

  it("블록 안을 사용자가 고쳤으면 skipped-modified, force면 갱신", async () => {
    await safeWrite([blockWrite("AGENTS.md", "v1")], opts());
    fs.writeFileSync(p("AGENTS.md"), `${S}\n내가 고침\n${E}\n`);
    const res = await safeWrite([blockWrite("AGENTS.md", "v2")], opts());
    expect(res.outcomes[0]?.status).toBe("skipped-modified");
    expect(read("AGENTS.md")).toBe(`${S}\n내가 고침\n${E}\n`);
    const forced = await safeWrite([blockWrite("AGENTS.md", "v2")], opts({ force: true }));
    expect(forced.outcomes[0]?.status).toBe("updated");
    expect(read("AGENTS.md")).toBe(`${S}\nv2\n${E}\n`);
  });

  it("매니페스트 없이 마커 블록이 이미 있고 내용이 다르면 skipped-unowned", async () => {
    fs.writeFileSync(p("AGENTS.md"), `${S}\n남이 쓴\n${E}\n`);
    const res = await safeWrite([blockWrite("AGENTS.md", "v1")], opts());
    expect(res.outcomes[0]?.status).toBe("skipped-unowned");
  });

  it("CRLF 파일이면 블록도 CRLF이고, 두 번째 실행은 unchanged", async () => {
    fs.writeFileSync(p("AGENTS.md"), "# 제목\r\n본문\r\n");
    await safeWrite([blockWrite("AGENTS.md", "a\nb")], opts());
    expect(read("AGENTS.md")).toBe(`# 제목\r\n본문\r\n\r\n${S}\r\na\r\nb\r\n${E}\r\n`);
    const again = await safeWrite([blockWrite("AGENTS.md", "a\nb")], opts());
    expect(again.outcomes[0]?.status).toBe("unchanged");
    const updated = await safeWrite([blockWrite("AGENTS.md", "c")], opts());
    expect(updated.outcomes[0]?.status).toBe("updated");
    expect(read("AGENTS.md")).toBe(`# 제목\r\n본문\r\n\r\n${S}\r\nc\r\n${E}\r\n`);
  });

  it.each([
    ["마커가 두 번 이상", `${S}\na\n${E}\n${S}\nb\n${E}\n`],
    ["시작만 있음", `${S}\na\n`],
    ["끝만 있음", `a\n${E}\n`],
    ["끝이 시작보다 앞", `${E}\na\n${S}\n`],
  ])("마커 짝이 안 맞으면(%s) skipped-invalid, force여도 쓰지 않는다", async (_label, text) => {
    fs.writeFileSync(p("AGENTS.md"), text);
    for (const force of [false, true]) {
      const res = await safeWrite([blockWrite("AGENTS.md", "x")], opts({ force }));
      expect(res.outcomes[0]?.status).toBe("skipped-invalid");
      expect(res.outcomes[0]?.reason).toBeTruthy();
      expect(read("AGENTS.md")).toBe(text);
    }
  });
});

describe("safeWrite — json-key 영역", () => {
  const server = { command: "npx", args: ["-y", "dsmith", "mcp"] };

  it("파일이 없으면 객체 경로를 만들어 쓴다(2칸 들여쓰기, 끝 개행 1개)", async () => {
    const res = await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], server)], opts());
    expect(res.outcomes[0]).toMatchObject({ region: "json-key", status: "created" });
    expect(read(".mcp.json")).toBe(`${JSON.stringify({ mcpServers: { dsmith: server } }, null, 2)}\n`);
  });

  it("다른 키를 보존하고 기존 4칸 들여쓰기를 유지한다", async () => {
    const original = { mcpServers: { other: { command: "x", args: ["1"] } }, extra: true };
    fs.writeFileSync(p(".mcp.json"), `${JSON.stringify(original, null, 4)}\n`);
    const res = await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], server)], opts());
    expect(res.outcomes[0]?.status).toBe("created");
    const text = read(".mcp.json");
    expect(text).toBe(
      `${JSON.stringify({ mcpServers: { other: original.mcpServers.other, dsmith: server }, extra: true }, null, 4)}\n`,
    );
    expect(text).toContain('\n    "mcpServers"');
  });

  it("탭 들여쓰기도 유지한다", async () => {
    fs.writeFileSync(p("s.json"), '{\n\t"a": 1\n}\n');
    await safeWrite([jsonWrite("s.json", ["b"], 2)], opts());
    expect(read("s.json")).toBe('{\n\t"a": 1,\n\t"b": 2\n}\n');
  });

  it("같은 값이면 unchanged(키 순서·공백 무관), 다른 값이면 updated", async () => {
    await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], server)], opts());
    const same = await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], server)], opts());
    expect(same.outcomes[0]?.status).toBe("unchanged");
    const next = { command: "dsmith", args: ["mcp"] };
    const res = await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], next)], opts());
    expect(res.outcomes[0]?.status).toBe("updated");
    expect(JSON.parse(read(".mcp.json")).mcpServers.dsmith).toEqual(next);
  });

  it("사용자가 고친 키 값은 skipped-modified, force면 updated(다른 키는 보존)", async () => {
    await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], server)], opts());
    const edited = { mcpServers: { dsmith: { command: "node", args: ["my.js"] }, other: { command: "y" } } };
    fs.writeFileSync(p(".mcp.json"), JSON.stringify(edited, null, 2));
    const res = await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], { command: "z" })], opts());
    expect(res.outcomes[0]?.status).toBe("skipped-modified");
    expect(JSON.parse(read(".mcp.json"))).toEqual(edited);
    const forced = await safeWrite(
      [jsonWrite(".mcp.json", ["mcpServers", "dsmith"], { command: "z" })],
      opts({ force: true }),
    );
    expect(forced.outcomes[0]?.status).toBe("updated");
    expect(JSON.parse(read(".mcp.json"))).toEqual({
      mcpServers: { dsmith: { command: "z" }, other: { command: "y" } },
    });
  });

  it("매니페스트 없이 키가 이미 있고 값이 다르면 skipped-unowned", async () => {
    fs.writeFileSync(p(".mcp.json"), JSON.stringify({ mcpServers: { dsmith: { command: "mine" } } }));
    const res = await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], server)], opts());
    expect(res.outcomes[0]?.status).toBe("skipped-unowned");
  });

  it("JSON이 깨졌으면 skipped-invalid, force여도 파일을 건드리지 않는다", async () => {
    fs.writeFileSync(p(".mcp.json"), "{");
    for (const force of [false, true]) {
      const res = await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], server)], opts({ force }));
      expect(res.outcomes[0]?.status).toBe("skipped-invalid");
      expect(read(".mcp.json")).toBe("{");
    }
    expect(fs.existsSync(p(".dsmith/install.json"))).toBe(false);
  });

  it("루트가 객체가 아니거나 경로 중간이 객체가 아니면 skipped-invalid", async () => {
    fs.writeFileSync(p("a.json"), "[1]");
    fs.writeFileSync(p("b.json"), '{"mcpServers": "문자열"}');
    const res = await safeWrite(
      [jsonWrite("a.json", ["k"], 1), jsonWrite("b.json", ["mcpServers", "dsmith"], 1)],
      opts({ force: true }),
    );
    expect(res.outcomes.map((o) => o.status)).toEqual(["skipped-invalid", "skipped-invalid"]);
    expect(read("a.json")).toBe("[1]");
    expect(read("b.json")).toBe('{"mcpServers": "문자열"}');
  });

  it("같은 파일의 두 영역을 한 번에 쓸 수 있다", async () => {
    const res = await safeWrite(
      [jsonWrite("s.json", ["a", "x"], 1), jsonWrite("s.json", ["a", "y"], 2), jsonWrite("s.json", ["b"], 3)],
      opts(),
    );
    expect(res.outcomes.map((o) => o.status)).toEqual(["created", "created", "created"]);
    expect(JSON.parse(read("s.json"))).toEqual({ a: { x: 1, y: 2 }, b: 3 });
  });
});

describe("safeWrite — dryRun", () => {
  it("파일시스템(매니페스트 포함)을 전혀 바꾸지 않고 diff를 돌려준다", async () => {
    fs.mkdirSync(p("docs"));
    fs.writeFileSync(p("AGENTS.md"), "# 본문\n");
    fs.writeFileSync(p(".mcp.json"), JSON.stringify({ mcpServers: { other: {} } }, null, 2));
    const before = treeHash(root);

    const res = await safeWrite(
      [
        fileWrite(".claude/skills/ds/SKILL.md", "새 스킬"),
        blockWrite("AGENTS.md", "규칙"),
        jsonWrite(".mcp.json", ["mcpServers", "dsmith"], { command: "dsmith" }),
      ],
      opts({ dryRun: true }),
    );

    expect(treeHash(root)).toBe(before);
    expect(fs.existsSync(p(".dsmith"))).toBe(false);
    expect(res.applied).toBe(false);
    expect(res.manifestChanged).toBe(true);
    expect(res.outcomes.map((o) => o.status)).toEqual(["created", "created", "created"]);
    for (const o of res.outcomes) {
      expect(o.diff).toBeDefined();
      expect(o.diff).toMatch(/^\+[^+]/m);
    }
    expect(res.outcomes[0]?.diff).toContain("+새 스킬");
  });

  it("기존 dsmith 파일의 dryRun은 updated를 예측하고 diff에 -/+가 모두 있다", async () => {
    await safeWrite([fileWrite("a.md", "old")], opts());
    const before = treeHash(root);
    const res = await safeWrite([fileWrite("a.md", "new")], opts({ dryRun: true }));
    expect(treeHash(root)).toBe(before);
    expect(res.outcomes[0]?.status).toBe("updated");
    expect(res.outcomes[0]?.diff).toContain("-old");
    expect(res.outcomes[0]?.diff).toContain("+new");
  });

  it("unchanged는 diff가 없고 manifestChanged도 false", async () => {
    await safeWrite([fileWrite("a.md", "x")], opts());
    const res = await safeWrite([fileWrite("a.md", "x")], opts({ dryRun: true }));
    expect(res.outcomes[0]).toEqual({ file: "a.md", key: "a.md", region: "file", status: "unchanged" });
    expect(res.manifestChanged).toBe(false);
  });
});

describe("safeWrite — 표시 경로", () => {
  it("displayRoot 밖이면 home 기준 `~/`, 아니면 절대 경로", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-home-"));
    try {
      const other = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-other-"));
      try {
        const res = await safeWrite(
          [
            { file: path.join(home, ".codex", "prompts", "ds.md"), region: { kind: "file" }, content: "x" },
            { file: path.join(other, "z.md"), region: { kind: "file" }, content: "y" },
            fileWrite("inside.md", "z"),
          ],
          opts({ home, confineTo: os.tmpdir() }),
        );
        expect(res.outcomes.map((o) => o.file)).toEqual([
          "~/.codex/prompts/ds.md",
          path.join(other, "z.md"),
          "inside.md",
        ]);
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("safeWrite — confineTo(경로 격리)", () => {
  let outside: string;
  beforeEach(() => {
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-outside-"));
  });
  afterEach(() => {
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("매니페스트가 밖을 가리키는 심볼릭 링크면 던지고 밖의 파일은 그대로", async () => {
    fs.mkdirSync(p(".dsmith"));
    fs.writeFileSync(path.join(outside, "victim.json"), "원본");
    fs.symlinkSync(path.join(outside, "victim.json"), p(".dsmith", "install.json"));
    await expect(safeWrite([fileWrite("a.md", "x")], opts())).rejects.toThrow(/매니페스트/);
    expect(fs.readFileSync(path.join(outside, "victim.json"), "utf-8")).toBe("원본");
    expect(fs.existsSync(p("a.md"))).toBe(false);
  });

  it("안쪽을 가리키는 매니페스트 심볼릭 링크도 거부한다", async () => {
    fs.mkdirSync(p(".dsmith"));
    fs.writeFileSync(p("real-manifest.json"), "{}");
    fs.symlinkSync(p("real-manifest.json"), p(".dsmith", "install.json"));
    await expect(safeWrite([fileWrite("a.md", "x")], opts())).rejects.toThrow(/심볼릭/);
  });

  it(".dsmith 디렉터리가 밖으로의 링크면 던진다", async () => {
    fs.symlinkSync(outside, p(".dsmith"));
    await expect(safeWrite([fileWrite("a.md", "x")], opts())).rejects.toThrow(/매니페스트/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("AGENTS.md가 밖으로의 링크면 skipped-invalid, 밖의 파일은 그대로(force여도)", async () => {
    fs.writeFileSync(path.join(outside, "AGENTS.md"), "밖의 본문\n");
    fs.symlinkSync(path.join(outside, "AGENTS.md"), p("AGENTS.md"));
    for (const force of [false, true]) {
      const res = await safeWrite([blockWrite("AGENTS.md", "x")], opts({ force }));
      expect(res.outcomes[0]?.status).toBe("skipped-invalid");
      expect(res.outcomes[0]?.reason).toContain("심볼릭");
    }
    expect(fs.readFileSync(path.join(outside, "AGENTS.md"), "utf-8")).toBe("밖의 본문\n");
    expect(fs.lstatSync(p("AGENTS.md")).isSymbolicLink()).toBe(true);
  });

  it(".mcp.json이 밖으로의 링크면 skipped-invalid, 키를 주입하지 않는다", async () => {
    fs.writeFileSync(path.join(outside, "mcp.json"), '{"mcpServers":{}}');
    fs.symlinkSync(path.join(outside, "mcp.json"), p(".mcp.json"));
    const res = await safeWrite([jsonWrite(".mcp.json", ["mcpServers", "dsmith"], { command: "x" })], opts());
    expect(res.outcomes[0]?.status).toBe("skipped-invalid");
    expect(fs.readFileSync(path.join(outside, "mcp.json"), "utf-8")).toBe('{"mcpServers":{}}');
    expect(fs.existsSync(p(".dsmith/install.json"))).toBe(false);
  });

  it("끊어진 심볼릭 링크와 밖으로의 상위 디렉터리 링크도 거부(밖에 아무것도 만들지 않음)", async () => {
    fs.symlinkSync(path.join(outside, "nope.md"), p("dangling.md"));
    fs.symlinkSync(outside, p(".claude"));
    const res = await safeWrite([fileWrite("dangling.md", "x"), fileWrite(".claude/skills/ds/SKILL.md", "y")], opts());
    expect(res.outcomes.map((o) => o.status)).toEqual(["skipped-invalid", "skipped-invalid"]);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("레포 안을 가리키는 심볼릭 링크는 따라가서 쓰고 링크는 유지한다", async () => {
    fs.mkdirSync(p("docs"));
    fs.writeFileSync(p("docs", "agents-real.md"), "# 본문\n");
    fs.symlinkSync(p("docs", "agents-real.md"), p("AGENTS.md"));
    const res = await safeWrite([blockWrite("AGENTS.md", "규칙")], opts());
    expect(res.outcomes[0]?.status).toBe("created");
    expect(fs.lstatSync(p("AGENTS.md")).isSymbolicLink()).toBe(true);
    expect(read("docs/agents-real.md")).toContain("규칙");
    const again = await safeWrite([blockWrite("AGENTS.md", "규칙")], opts());
    expect(again.outcomes[0]?.status).toBe("unchanged");
  });

  it("stow 스타일: confineTo(홈) 안에서 홈 안쪽으로 향하는 디렉터리 링크는 허용", async () => {
    fs.mkdirSync(p("dotfiles", "claude"), { recursive: true });
    fs.symlinkSync(p("dotfiles", "claude"), p(".claude"));
    const res = await safeWrite([fileWrite(".claude/commands/ds.md", "x")], opts());
    expect(res.outcomes[0]?.status).toBe("created");
    expect(read("dotfiles/claude/commands/ds.md")).toBe("x\n");
  });

  it("confineTo 자체가 심볼릭 링크 경로여도 realpath로 비교한다", async () => {
    const alias = path.join(outside, "alias");
    fs.symlinkSync(root, alias);
    const res = await safeWrite([fileWrite("a.md", "x")], opts({ confineTo: alias }));
    expect(res.outcomes[0]?.status).toBe("created");
  });

  it("상대 경로 file·manifestFile·confineTo는 던진다", async () => {
    await expect(safeWrite([{ file: "a.md", region: { kind: "file" }, content: "x" }], opts())).rejects.toThrow(/절대/);
    await expect(safeWrite([fileWrite("a.md", "x")], opts({ confineTo: "rel" }))).rejects.toThrow(/절대/);
    await expect(safeWrite([fileWrite("a.md", "x")], opts({ manifestFile: "m.json" }))).rejects.toThrow(/절대/);
  });
});

describe("safeWrite — 매니페스트 키 기준", () => {
  it("글로벌 스코프를 서로 다른 displayRoot(cwd)에서 써도 키가 같아 두 번째는 unchanged", async () => {
    const home = p("home");
    fs.mkdirSync(home);
    const global = (displayRoot: string): SafeWriteOptions =>
      opts({ manifestFile: path.join(home, ".dsmith", "install.json"), confineTo: home, displayRoot, home });
    const writes: PlannedWrite[] = [
      { file: path.join(home, ".codex", "prompts", "ds.md"), region: { kind: "file" }, content: "x" },
    ];
    const first = await safeWrite(writes, global(p("repo-a")));
    expect(first.outcomes[0]?.status).toBe("created");
    const second = await safeWrite(writes, global(home));
    expect(second.outcomes[0]?.status).toBe("unchanged");
    expect(second.manifestChanged).toBe(false);
    const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(home, ".dsmith", "install.json"), "utf-8")).entries);
    expect(keys).toEqual([".codex/prompts/ds.md"]);
    expect(first.outcomes[0]?.key).toBe(".codex/prompts/ds.md");
  });
});

describe("safeWrite — 안전성 보강", () => {
  it("`__proto__`라는 이름의 파일도 매니페스트 키로 안전하게 왕복한다", async () => {
    await safeWrite([fileWrite("__proto__", "x")], opts());
    expect(Object.hasOwn(JSON.parse(read(".dsmith/install.json")).entries, "__proto__")).toBe(true);
    const again = await safeWrite([fileWrite("__proto__", "x")], opts());
    expect(again.outcomes[0]?.status).toBe("unchanged");
    expect(({} as Record<string, unknown>).sha256).toBeUndefined();
    const next = await safeWrite([fileWrite("__proto__", "y")], opts());
    expect(next.outcomes[0]?.status).toBe("updated");
  });

  it("keyPath에 __proto__가 있거나 비어 있으면 skipped-invalid, 오염·쓰기 없음", async () => {
    const res = await safeWrite(
      [jsonWrite("s.json", ["__proto__", "polluted"], true), jsonWrite("s.json", [], 1)],
      opts({ force: true }),
    );
    expect(res.outcomes.map((o) => o.status)).toEqual(["skipped-invalid", "skipped-invalid"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(fs.existsSync(p("s.json"))).toBe(false);
  });

  it("블록 마커 오용(시작=끝, 내용에 마커 줄, 빈 마커)은 던진다", async () => {
    const region = (start: string, end: string): PlannedWrite["region"] => ({ kind: "block", start, end });
    const w = (r: PlannedWrite["region"], content: string): PlannedWrite => ({ file: p("A.md"), region: r, content });
    await expect(safeWrite([w(region("<!-- m -->", "<!-- m -->"), "x")], opts())).rejects.toThrow(/마커/);
    await expect(safeWrite([w(region("<!-- s -->", "<!-- e -->"), "a\n<!-- e -->\nb")], opts())).rejects.toThrow(/마커/);
    await expect(safeWrite([w(region("", "<!-- e -->"), "a")], opts())).rejects.toThrow(/마커/);
    expect(fs.existsSync(p("A.md"))).toBe(false);
  });

  it("JSON 재작성은 CRLF·BOM을 유지하고 들여쓰기는 키 줄에서 잡는다", async () => {
    const original = '﻿{"list": [\r\n      1,\r\n      2\r\n    ],\r\n  "other": true}\r\n';
    fs.writeFileSync(p("s.json"), original);
    await safeWrite([jsonWrite("s.json", ["added"], 1)], opts());
    const text = fs.readFileSync(p("s.json"), "utf-8");
    expect(text.startsWith("﻿{")).toBe(true);
    expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(text.endsWith("}\r\n")).toBe(true);
    expect(text).toContain('\r\n  "other": true');
    expect(JSON.parse(text.slice(1))).toEqual({ list: [1, 2], other: true, added: 1 });
    const again = await safeWrite([jsonWrite("s.json", ["added"], 1)], opts());
    expect(again.outcomes[0]?.status).toBe("unchanged");
  });

  it("BOM이 있는 file 영역은 BOM을 비교에서 제외하고 갱신 시 유지한다", async () => {
    fs.writeFileSync(p("a.md"), "﻿same\n");
    const res = await safeWrite([fileWrite("a.md", "same")], opts());
    expect(res.outcomes[0]?.status).toBe("unchanged");
    const next = await safeWrite([fileWrite("a.md", "next")], opts());
    expect(next.outcomes[0]?.status).toBe("updated");
    expect(read("a.md")).toBe("﻿next\n");
  });

  it("JSONC(주석·후행 쉼표)는 일반 파싱 실패와 다른 사유로 skipped-invalid", async () => {
    fs.writeFileSync(p("c.json"), '{\n  // 주석\n  "a": 1,\n}\n');
    fs.writeFileSync(p("bad.json"), "{");
    const res = await safeWrite(
      [jsonWrite("c.json", ["b"], 1), jsonWrite("bad.json", ["b"], 1)],
      opts({ force: true }),
    );
    expect(res.outcomes.map((o) => o.status)).toEqual(["skipped-invalid", "skipped-invalid"]);
    expect(res.outcomes[0]?.reason).toContain("JSONC");
    expect(res.outcomes[1]?.reason).not.toContain("JSONC");
    expect(read("c.json")).toBe('{\n  // 주석\n  "a": 1,\n}\n');
  });

  it("임시 파일(.tmp-*)을 남기지 않는다", async () => {
    await safeWrite([fileWrite("a/b.md", "x"), jsonWrite("s.json", ["k"], 1)], opts());
    const all = fs.readdirSync(root, { recursive: true }).map(String);
    expect(all.filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  it("기존 파일의 권한을 유지한다", async () => {
    await safeWrite([fileWrite("run.sh", "v1")], opts());
    fs.chmodSync(p("run.sh"), 0o755);
    await safeWrite([fileWrite("run.sh", "v2")], opts());
    expect(fs.statSync(p("run.sh")).mode & 0o777).toBe(0o755);
  });
});
