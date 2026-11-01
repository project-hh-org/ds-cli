import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatches, invertPatches, partitionPatches, type TextPatch } from "../src/patch/apply.js";
import { validateEdit } from "../src/patch/validate.js";
import { sha256Text, writePatchedFile } from "../src/patch/write.js";

const p = (start: number, end: number, replacement: string): TextPatch => ({ start, end, replacement });

describe("partitionPatches", () => {
  it("겹치는 두 패치는 둘 다 conflicts, accepted에서 제외", () => {
    const r = partitionPatches([p(0, 5, "a"), p(3, 8, "b"), p(10, 12, "c")]);
    expect(r.accepted).toEqual([p(10, 12, "c")]);
    expect(r.conflicts).toEqual([{ a: p(0, 5, "a"), b: p(3, 8, "b") }]);
  });

  it("한쪽이 다른 쪽을 포함해도 충돌", () => {
    const r = partitionPatches([p(0, 10, "a"), p(2, 4, "b")]);
    expect(r.accepted).toEqual([]);
    expect(r.conflicts).toHaveLength(1);
  });

  it("같은 패치 2개는 하나로 합친다", () => {
    const r = partitionPatches([p(1, 3, "x"), p(1, 3, "x"), p(5, 6, "y")]);
    expect(r.accepted).toEqual([p(1, 3, "x"), p(5, 6, "y")]);
    expect(r.merged).toBe(1);
    expect(r.conflicts).toEqual([]);
  });

  it("인접(end === start)은 허용, 삽입은 경계·같은 위치 삽입과 겹치지 않고 구간 안쪽이면 충돌", () => {
    expect(partitionPatches([p(0, 3, "a"), p(3, 6, "b")]).conflicts).toEqual([]);
    expect(partitionPatches([p(3, 3, "<"), p(3, 6, "b"), p(0, 3, "a")]).accepted).toHaveLength(3);
    expect(partitionPatches([p(3, 3, "<"), p(3, 3, ">")]).accepted).toHaveLength(2);
    expect(partitionPatches([p(0, 6, "a"), p(3, 3, "<")]).conflicts).toHaveLength(1);
  });

  it("accepted는 start 오름차순", () => {
    const r = partitionPatches([p(8, 9, "c"), p(0, 1, "a"), p(4, 5, "b")]);
    expect(r.accepted.map((x) => x.start)).toEqual([0, 4, 8]);
  });
});

describe("applyPatches", () => {
  it("역순으로 적용해 앞 패치가 뒤 좌표를 밀지 않는다", () => {
    expect(applyPatches("0123456789", [p(1, 2, "AAAA"), p(5, 7, "")])).toBe("0AAAA234789");
  });

  it("같은 위치 삽입은 정렬 순서대로 나온다", () => {
    expect(applyPatches("ab", [p(1, 1, "X"), p(1, 1, "Y")])).toBe("aXYb");
  });

  it("겹치거나 범위를 벗어나면 Error", () => {
    expect(() => applyPatches("0123456789", [p(0, 5, "a"), p(3, 8, "b")])).toThrow();
    expect(() => applyPatches("012", [p(1, 9, "a")])).toThrow();
  });
});

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("invertPatches", () => {
  it("applyPatches(applyPatches(c, p), invertPatches(c, p)) === c — 시드 고정 무작위 20케이스", () => {
    const rand = rng(20261101);
    for (let n = 0; n < 20; n++) {
      const len = 20 + Math.floor(rand() * 60);
      const code = Array.from({ length: len }, () => String.fromCharCode(97 + Math.floor(rand() * 26))).join("");
      const patches: TextPatch[] = [];
      let at = 0;
      while (at < len) {
        const start = at + Math.floor(rand() * 8);
        if (start > len) break;
        const end = Math.min(len, start + Math.floor(rand() * 6));
        const replacement = "#".repeat(Math.floor(rand() * 9));
        patches.push(p(start, end, replacement));
        at = end;
      }
      expect(patches.length).toBeGreaterThan(0);
      const after = applyPatches(code, patches);
      expect(applyPatches(after, invertPatches(code, patches)), `case ${n}`).toBe(code);
    }
  });

  it("늘고 줄고 빈 치환이 섞여도 왕복", () => {
    const code = "aaa bbb ccc ddd";
    const patches = [p(0, 3, "AAAAAAAA"), p(4, 7, ""), p(8, 11, "C"), p(15, 15, "!")];
    const after = applyPatches(code, patches);
    expect(after).toBe("AAAAAAAA  C ddd!");
    expect(applyPatches(after, invertPatches(code, patches))).toBe(code);
  });
});

describe("validateEdit", () => {
  it("tsx: 따옴표가 깨지면 ok:false", () => {
    const before = 'export const A = () => <div className="a">x</div>;\n';
    const after = 'export const A = () => <div className="a>x</div>;\n';
    expect(validateEdit("a.tsx", before, after).ok).toBe(false);
    expect(validateEdit("a.tsx", before, before.replace('"a"', '"b"'))).toEqual({ ok: true });
  });

  it("원래 복구 가능한 오류가 있던 파일의 무관한 수정은 ok", () => {
    const before = "const a = 1;\nconst a = 2;\nconst c = 'x';\n";
    expect(validateEdit("a.ts", before, before.replace("'x'", "'y'"))).toEqual({ ok: true });
  });

  it("css: 값만 바뀌면 ok, 괄호가 어긋나면 ok:false", () => {
    expect(validateEdit("a.css", "a { color: #fff; }", "a { color: var(--c); }")).toEqual({ ok: true });
    expect(validateEdit("a.css", "a { color: #fff; }", "a { color: var(--c; }").ok).toBe(false);
  });

  it("scss의 // 주석 안 괄호는 세지 않는다", () => {
    expect(validateEdit("a.scss", "a { color: #fff; }", "a { color: var(--c); } // )").ok).toBe(true);
  });

  it("그 밖의 확장자는 검증할 수 없음", () => {
    expect(validateEdit("README.md", "a", "b")).toEqual({ ok: false, reason: "검증할 수 없는 파일 형식" });
  });
});

describe("writePatchedFile", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-patchwrite-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("해시가 맞으면 쓰고, 틀리면 쓰지 않는다", async () => {
    fs.writeFileSync(path.join(root, "a.tsx"), "old\r\n");
    expect(await writePatchedFile(root, "a.tsx", sha256Text("old\r\n"), "new\r\n")).toEqual({ written: true });
    expect(fs.readFileSync(path.join(root, "a.tsx"), "utf-8")).toBe("new\r\n");
    const stale = await writePatchedFile(root, "a.tsx", sha256Text("old\r\n"), "again");
    expect(stale).toEqual({ written: false, reason: "계획 뒤 파일이 바뀜" });
    expect(fs.readFileSync(path.join(root, "a.tsx"), "utf-8")).toBe("new\r\n");
  });

  it("BOM을 그대로 보존해 해시를 비교한다", async () => {
    fs.writeFileSync(path.join(root, "a.css"), "﻿a{}");
    expect((await writePatchedFile(root, "a.css", sha256Text("﻿a{}"), "﻿b{}")).written).toBe(true);
    expect(fs.readFileSync(path.join(root, "a.css"), "utf-8")).toBe("﻿b{}");
  });

  it("root 밖을 가리키는 심볼릭 링크는 쓰지 않는다", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "x.ts"), "x");
      fs.symlinkSync(path.join(outside, "x.ts"), path.join(root, "link.ts"));
      const r = await writePatchedFile(root, "link.ts", sha256Text("x"), "y");
      expect(r.written).toBe(false);
      expect(fs.readFileSync(path.join(outside, "x.ts"), "utf-8")).toBe("x");
      fs.symlinkSync(outside, path.join(root, "dir"));
      expect((await writePatchedFile(root, "dir/x.ts", sha256Text("x"), "y")).written).toBe(false);
      expect(fs.readFileSync(path.join(outside, "x.ts"), "utf-8")).toBe("x");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("root 밖 경로·없는 파일은 쓰지 않는다", async () => {
    expect((await writePatchedFile(root, "../x.ts", "", "y")).written).toBe(false);
    expect((await writePatchedFile(root, "none.ts", "", "y")).written).toBe(false);
  });
});
