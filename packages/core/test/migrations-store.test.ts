import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MigrationRecord } from "../src/migrations/model.js";
import { MIGRATIONS_DIR, listMigrations, newMigrationId, readMigration, writeMigration } from "../src/migrations/store.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-mig-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const rec = (id: string, over: Partial<MigrationRecord> = {}): MigrationRecord => ({
  version: 1,
  id,
  dsmith: "0.1.0",
  createdAt: "2026-11-01T14:30:05.000Z",
  status: "applied",
  summary: { tokens: 2, components: 0, files: 1 },
  files: [
    {
      file: "src/a.tsx",
      before: "aa",
      after: "bb",
      patches: [{ start: 1, end: 3, replacement: "var(--x)", original: "#f" }],
      status: "applied",
    },
  ],
  ...over,
});

describe("migrations store", () => {
  it("newMigrationId: 로컬 시각 형식, 같은 초에 기록이 있으면 -2, -3", async () => {
    const now = new Date(2026, 10, 1, 14, 30, 5);
    const a = await newMigrationId(root, now);
    expect(a).toBe("20261101-143005");
    await writeMigration(root, rec(a));
    const b = await newMigrationId(root, now);
    expect(b).toBe("20261101-143005-2");
    await writeMigration(root, rec(b));
    expect(await newMigrationId(root, now)).toBe("20261101-143005-3");
  });

  it("write → read 왕복, 경로·형식(2칸 들여쓰기 + 개행)", async () => {
    const r = rec("20261101-143005", { branch: { name: "dsmith/migrate-20261101-143005", base: "main", commit: null } });
    expect(await writeMigration(root, r)).toBe(`${MIGRATIONS_DIR}/20261101-143005.json`);
    expect(fs.readFileSync(path.join(root, MIGRATIONS_DIR, "20261101-143005.json"), "utf-8")).toBe(`${JSON.stringify(r, null, 2)}\n`);
    expect(await readMigration(root, "20261101-143005")).toEqual(r);
    expect(await readMigration(root, "20260101-000000")).toBeNull();
  });

  it("listMigrations: id 내림차순, 요약·브랜치 포함", async () => {
    await writeMigration(root, rec("20261101-100000"));
    await writeMigration(root, rec("20261101-100000-2", { status: "reverted" }));
    await writeMigration(root, rec("20261102-090000", { branch: { name: "b", base: "main", commit: "abc" } }));
    expect((await listMigrations(root)).map((m) => m.id)).toEqual(["20261102-090000", "20261101-100000-2", "20261101-100000"]);
    const list = await listMigrations(root);
    expect(list[0]).toMatchObject({ status: "applied", branch: "b", summary: { tokens: 2, components: 0, files: 1 } });
    expect(list[1]?.status).toBe("reverted");
    expect(list.map((m) => m.close)).toEqual([false, false, false]);
  });

  it("listMigrations: --close로 계획한 기록은 close true (M2)", async () => {
    await writeMigration(root, rec("20261101-100000", { close: true }));
    await writeMigration(root, rec("20261101-110000"));
    expect((await listMigrations(root)).map((m) => [m.id, m.close])).toEqual([
      ["20261101-110000", false],
      ["20261101-100000", true],
    ]);
  });

  it("기록이 없으면 빈 목록", async () => {
    expect(await listMigrations(root)).toEqual([]);
  });

  it("newMigrationId는 동시에 불러도 서로 다른 id를 예약한다", async () => {
    const now = new Date(2026, 10, 1, 9, 0, 0);
    const ids = await Promise.all(Array.from({ length: 6 }, () => newMigrationId(root, now)));
    expect(new Set(ids).size).toBe(6);
    expect(ids).toContain("20261101-090000");
    expect(await listMigrations(root)).toEqual([]); // 예약만 된 id는 목록·읽기에서 기록 없음
    expect(await readMigration(root, ids[0]!)).toBeNull();
  });

  it("version이 1이 아닌 기록은 분명한 Error", async () => {
    fs.mkdirSync(path.join(root, MIGRATIONS_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, MIGRATIONS_DIR, "x.json"), JSON.stringify({ ...rec("x"), version: 2 }));
    await expect(readMigration(root, "x")).rejects.toThrow(/version이 2/);
  });

  it("id에 경로 조각이 있으면 Error", async () => {
    await expect(readMigration(root, "../x")).rejects.toThrow();
    await expect(readMigration(root, "a/b")).rejects.toThrow();
    await expect(writeMigration(root, rec("../x"))).rejects.toThrow();
  });
});
