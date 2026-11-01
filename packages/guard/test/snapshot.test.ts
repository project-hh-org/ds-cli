import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { staleGuardTokenFiles } from "@dsmith-dev/core";
import type { DetectResult } from "@dsmith-dev/detect";
import { buildGuardSnapshot } from "../src/index.js";
import { cleanupTmps, cloneRepo, keep, monoRepo, preparedDemo } from "./helpers.js";

afterEach(cleanupTmps);
afterAll(() => fs.rmSync(prepared.root, { recursive: true, force: true }));

let prepared: { root: string; detect: DetectResult };
beforeAll(async () => {
  prepared = await preparedDemo();
  keep(prepared.root);
}, 120_000);

describe("buildGuardSnapshot", () => {
  it("npm 디자인시스템이면 ds.modules에 패키지 이름이 들어가고 정렬돼 있다", async () => {
    const root = cloneRepo(prepared.root);
    const detect: DetectResult = { ...prepared.detect, ds: { ...prepared.detect.ds, kind: "npm", packageName: "@acme/ui", packageNames: ["@acme/ui", "@acme/icons"] } };
    const snap = await buildGuardSnapshot({ root, detect, version: "0.1.0", existing: null });
    expect(snap.ds.modules).toEqual(expect.arrayContaining(["@acme/icons", "@acme/ui"]));
    expect(snap.ds.modules).toEqual([...snap.ds.modules].sort());
    expect(snap.ds.modules.indexOf("@acme/icons")).toBeLessThan(snap.ds.modules.indexOf("@acme/ui"));
  });

  it("packageNames 없이 packageName만 있어도 modules에 들어간다", async () => {
    const root = cloneRepo(prepared.root);
    const { packageNames: _drop, ...ds } = prepared.detect.ds;
    void _drop;
    const detect: DetectResult = { ...prepared.detect, ds: { ...ds, kind: "npm", packageName: "@acme/ui" } };
    const snap = await buildGuardSnapshot({ root, detect, version: "0.1.0", existing: null });
    expect(snap.ds.modules).toContain("@acme/ui");
  });

  it("모노레포 하위 디렉터리 root에서도 절대 경로·toplevel 경로 없이 root 상대 경로만 담는다", async () => {
    const { top, root } = monoRepo(prepared.root);
    const snap = await buildGuardSnapshot({ root, detect: prepared.detect, version: "0.1.0", existing: null });
    const text = JSON.stringify(snap);
    expect(text).not.toContain(top);
    expect(snap.tokenFiles.map((t) => t.file)).toEqual(expect.arrayContaining(["tailwind.config.ts"]));
    expect(snap.tokenFiles.every((t) => !t.file.startsWith("apps/"))).toBe(true);
    expect(await staleGuardTokenFiles(root, snap)).toEqual([]);
  });

  it("토큰 파일 이름을 바꾸면 옛 경로가 stale로 잡힌다", async () => {
    const root = cloneRepo(prepared.root);
    const snap = await buildGuardSnapshot({ root, detect: prepared.detect, version: "0.1.0", existing: null });
    fs.renameSync(path.join(root, "tailwind.config.ts"), path.join(root, "tailwind.config.renamed.ts"));
    expect(await staleGuardTokenFiles(root, snap)).toEqual(["tailwind.config.ts"]);
  });
});
