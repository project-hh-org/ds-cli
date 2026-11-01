import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { DEFAULT_GUARD_POLICY, normalizeColor, type GuardSnapshot } from "@dsmith-dev/core";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-eslint-")));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const color = (raw: string) => {
  const n = normalizeColor(raw);
  if (n === null) throw new Error(raw);
  return n;
};

export const TOKENS: GuardSnapshot["tokens"] = [
  { name: "--color-blue-500", value: "#3b82f6", category: "color", normalized: color("#3b82f6") },
  { name: "--space-2", value: "8px", category: "spacing", normalized: { kind: "length", px: 8 } },
  { name: "--space-4", value: "16px", category: "spacing", normalized: { kind: "length", px: 16 } },
];

export function snapshotOf(over: Partial<GuardSnapshot> = {}): GuardSnapshot {
  return {
    version: 1,
    dsmith: "0.1.0",
    extractors: ["inline-style", "tailwind", "css", "styled", "emotion", "mui-sx"],
    tokens: TOKENS,
    tokenSource: "token-file",
    tokenFiles: [],
    ds: { modules: ["components/ui"], components: [] },
    preferred: [],
    preset: null,
    exclude: ["**/node_modules/**"],
    moduleContext: { tsPaths: null, baseUrlEntries: [], dependencies: ["react"] },
    policy: DEFAULT_GUARD_POLICY,
    ...over,
  };
}

export interface TestRoot {
  root: string;
  guardFile: string;
  /** root 아래 절대 경로 */
  abs: (file: string) => string;
}

/** 임시 root에 `.dsmith/guard.json`을 쓴다(동기). snapshot이 null이면 스냅샷 없이 만든다. */
export function makeRoot(name: string, snapshot: GuardSnapshot | null): TestRoot {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, ".dsmith"), { recursive: true });
  const guardFile = path.join(root, ".dsmith", "guard.json");
  if (snapshot === null) fs.rmSync(path.join(root, ".dsmith"), { recursive: true, force: true });
  else fs.writeFileSync(guardFile, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { root, guardFile, abs: (file) => path.join(root, file) };
}

export function writeSnapshot(guardFile: string, snapshot: GuardSnapshot | string, mtimeSeconds?: number): void {
  fs.writeFileSync(guardFile, typeof snapshot === "string" ? snapshot : `${JSON.stringify(snapshot, null, 2)}\n`);
  if (mtimeSeconds !== undefined) fs.utimesSync(guardFile, mtimeSeconds, mtimeSeconds);
}
