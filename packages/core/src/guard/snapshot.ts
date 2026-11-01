// 동기 전용 모듈 — ESLint 플러그인이 쓴다. async·Promise·fs/promises 금지(테스트로 고정).
// 쓰기와 낡음 판정(비동기)은 ./write.ts.
import fs from "node:fs";
import path from "node:path";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import type { ModuleContext } from "../index/component-usage.js";
import type { TsPaths } from "../index/specifier.js";
import type { Token } from "../model/token.js";
import { DEFAULT_GUARD_POLICY, type GuardPolicy, type RuleContext } from "../rules/model.js";

export const GUARD_FILE = ".dsmith/guard.json";

/** extractor-api의 TailwindPreset과 같은 모양(Task 2). core는 구조만 알면 된다 */
export interface GuardPreset {
  version: 3 | 4;
  file: string;
  linked: boolean;
  keys: Record<string, string>;
}

export interface GuardSnapshot {
  version: 1;
  dsmith: string;
  extractors: string[];
  tokens: { name: string; value: string; category: Token["category"]; normalized: StyleUsage["normalized"]; path?: string }[];
  tokenSource: "token-file" | "catalog" | "none";
  tokenFiles: { file: string; sha256: string }[];
  ds: RuleContext["ds"];
  preferred: RuleContext["preferred"];
  preset: GuardPreset | null;
  exclude: string[];
  moduleContext: { tsPaths: TsPaths | null; baseUrlEntries: string[]; dependencies: string[] };
  policy: GuardPolicy;
}

/** fromDir에서 위로 올라가며 .dsmith/guard.json을 찾는다. 없으면 null */
export function findGuardSnapshotSync(fromDir: string): { root: string; file: string } | null {
  let dir = path.resolve(fromDir);
  for (;;) {
    const file = path.join(dir, GUARD_FILE);
    try {
      if (fs.statSync(file).isFile()) return { root: dir, file };
    } catch {
      // 없음 — 위로
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const REQUIRED = ["extractors", "tokens", "tokenSource", "tokenFiles", "ds", "preferred", "exclude", "moduleContext"] as const;

export function readGuardSnapshotSync(file: string): GuardSnapshot {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("객체가 아님");
    data = parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`guard 스냅샷을 읽을 수 없음: ${file} (${(err as Error).message})`);
  }
  if (data["version"] !== 1) throw new Error(`guard 스냅샷 version이 1이 아님: ${file}`);
  for (const key of REQUIRED) {
    if (data[key] === undefined) throw new Error(`guard 스냅샷에 ${key}가 없음: ${file}`);
  }
  const p = (data["policy"] ?? {}) as Partial<GuardPolicy>;
  const policy: GuardPolicy = {
    allow: {
      files: p.allow?.files ?? DEFAULT_GUARD_POLICY.allow.files,
      properties: p.allow?.properties ?? DEFAULT_GUARD_POLICY.allow.properties,
    },
    minConfidence: p.minConfidence ?? DEFAULT_GUARD_POLICY.minConfidence,
    failOn: {
      newHardcoded: p.failOn?.newHardcoded ?? DEFAULT_GUARD_POLICY.failOn.newHardcoded,
      deprecated: p.failOn?.deprecated ?? DEFAULT_GUARD_POLICY.failOn.deprecated,
    },
  };
  return { ...(data as unknown as GuardSnapshot), dsmith: String(data["dsmith"] ?? ""), preset: (data["preset"] ?? null) as GuardPreset | null, policy };
}

export function ruleContextOf(s: GuardSnapshot): RuleContext {
  return {
    tokens: s.tokens.map((t) => ({ name: t.name, value: t.value, category: t.category, normalized: t.normalized, ...(t.path !== undefined ? { path: t.path } : {}) })),
    ds: s.ds,
    preferred: s.preferred,
    policy: s.policy,
  };
}

export function moduleContextOf(s: GuardSnapshot): ModuleContext {
  return { baseUrlEntries: new Set(s.moduleContext.baseUrlEntries), dependencies: new Set(s.moduleContext.dependencies) };
}
