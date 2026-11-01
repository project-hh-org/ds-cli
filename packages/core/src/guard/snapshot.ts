// 동기 전용 모듈 — ESLint 플러그인이 쓴다. async·Promise·fs/promises 금지(테스트로 고정).
// 쓰기와 낡음 판정(비동기)은 ./write.ts.
import fs from "node:fs";
import path from "node:path";
import type { StyleProperty, StyleUsage, TailwindPreset } from "@dsmith-dev/extractor-api";
import type { ModuleContext } from "../index/component-usage.js";
import type { TsPaths } from "../index/specifier.js";
import type { Token } from "../model/token.js";
import { DEFAULT_GUARD_POLICY, type GuardPolicy, type RuleContext } from "../rules/model.js";

export const GUARD_FILE = ".dsmith/guard.json";

export type GuardPreset = TailwindPreset;

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
const PROPERTIES: readonly StyleProperty[] = [
  "color", "background-color", "border-color", "fill", "stroke", "padding", "margin", "gap", "width", "height", "font-size", "border-radius", "other",
];

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function validate(data: Record<string, unknown>): void {
  const bad = (what: string): never => {
    throw new Error(what);
  };
  if (!isStrArr(data["extractors"])) bad("extractors는 문자열 배열이어야 함");
  if (!isStrArr(data["exclude"])) bad("exclude는 문자열 배열이어야 함");
  const tokens = data["tokens"];
  if (!Array.isArray(tokens) || !tokens.every((t) => isObj(t) && typeof t["name"] === "string" && typeof t["value"] === "string" && typeof t["category"] === "string" && isObj(t["normalized"]))) {
    bad("tokens는 {name,value,category,normalized} 배열이어야 함");
  }
  if (!["token-file", "catalog", "none"].includes(String(data["tokenSource"]))) bad("tokenSource가 올바르지 않음");
  const files = data["tokenFiles"];
  if (!Array.isArray(files) || !files.every((f) => isObj(f) && typeof f["file"] === "string" && typeof f["sha256"] === "string")) bad("tokenFiles는 {file,sha256} 배열이어야 함");
  const ds = data["ds"];
  if (!isObj(ds) || !isStrArr(ds["modules"]) || !Array.isArray(ds["components"]) || !ds["components"].every((c) => isObj(c) && typeof c["name"] === "string" && typeof c["module"] === "string")) {
    bad("ds는 {modules: string[], components: {name,module}[]}여야 함");
  }
  const pref = data["preferred"];
  if (!Array.isArray(pref) || !pref.every((p) => isObj(p) && typeof p["name"] === "string" && typeof p["module"] === "string")) bad("preferred는 {name,module} 배열이어야 함");
  const mc = data["moduleContext"];
  if (!isObj(mc) || !isStrArr(mc["baseUrlEntries"]) || !isStrArr(mc["dependencies"])) bad("moduleContext가 올바르지 않음");
  const pol = data["policy"];
  if (pol !== undefined) {
    if (!isObj(pol)) bad("policy는 객체여야 함");
    const p = pol as Record<string, unknown>;
    if (p["minConfidence"] !== undefined && p["minConfidence"] !== "exact" && p["minConfidence"] !== "close") bad("policy.minConfidence는 exact|close여야 함");
    const allow = p["allow"];
    if (allow !== undefined) {
      if (!isObj(allow)) bad("policy.allow는 객체여야 함");
      const al = allow as Record<string, unknown>;
      if (al["files"] !== undefined && !isStrArr(al["files"])) bad("policy.allow.files는 문자열 배열이어야 함");
      if (al["properties"] !== undefined && !(isStrArr(al["properties"]) && al["properties"].every((x) => PROPERTIES.includes(x as StyleProperty)))) {
        bad(`policy.allow.properties는 속성 이름 배열이어야 함 (${PROPERTIES.join(", ")})`);
      }
    }
    const fo = p["failOn"];
    if (fo !== undefined && !(isObj(fo) && Object.values(fo).every((n) => typeof n === "number"))) bad("policy.failOn은 숫자 객체여야 함");
  }
}

export function readGuardSnapshotSync(file: string): GuardSnapshot {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!isObj(parsed)) throw new Error("객체가 아님");
    data = parsed;
  } catch (err) {
    throw new Error(`guard 스냅샷을 읽을 수 없음: ${file} (${(err as Error).message}) — dsmith guard init으로 다시 만드세요`);
  }
  if (data["version"] !== 1) throw new Error(`guard 스냅샷 version이 1이 아님: ${file} — dsmith guard init으로 다시 만드세요`);
  for (const key of REQUIRED) {
    if (data[key] === undefined) throw new Error(`guard 스냅샷에 ${key}가 없음: ${file}`);
  }
  try {
    validate(data);
  } catch (err) {
    throw new Error(`guard 스냅샷이 올바르지 않음: ${file} (${(err as Error).message})`);
  }
  const p = (data["policy"] ?? {}) as Partial<GuardPolicy>;
  const policy: GuardPolicy = {
    allow: {
      files: [...(p.allow?.files ?? DEFAULT_GUARD_POLICY.allow.files)],
      properties: [...(p.allow?.properties ?? DEFAULT_GUARD_POLICY.allow.properties)],
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
