import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentMeta, Condition, RunRecord } from "./model.js";
import type { Base } from "./base.js";
import type { FileChange } from "./score.js";

const MAX_BYTES = 1024 * 1024;
const RUN_STATUSES: readonly RunRecord["status"][] = ["ok", "agent-error", "timeout", "replay", "missing"];
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.quotepath=false", ...args],
      { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } },
      (err, stdout) => {
        if (err !== null && typeof err.code !== "number") reject(err);
        else resolve({ code: typeof err?.code === "number" ? err.code : 0, stdout: stdout.toString("utf-8") });
      },
    );
  });
}

async function headContent(copy: string, file: string): Promise<string | null> {
  const r = await git(copy, ["show", `HEAD:${file}`]);
  return r.code === 0 ? r.stdout : null;
}

/** 파일 내용. 바이너리(NUL 포함)·1MB 초과·읽기 실패는 null — 채점에서 ignored로 취급된다. */
async function readText(file: string): Promise<string | null> {
  try {
    const st = await fs.stat(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const buf = await fs.readFile(file);
    return buf.includes(0) ? null : buf.toString("utf-8");
  } catch {
    return null;
  }
}

async function present(file: string): Promise<boolean> {
  try {
    return (await fs.lstat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * `git status --porcelain=v1 -z -uall`(cwd=copy) → added/modified/deleted. 이름 변경은 새 경로 added + 옛 경로 deleted.
 * before = `git show HEAD:<file>`(없으면 null), after = 파일 내용(바이너리·1MB 초과는 null). .gitignore 대상은 git이 이미 뺀다.
 */
export async function collectChanges(copy: string): Promise<FileChange[]> {
  const status = await git(copy, ["status", "--porcelain=v1", "-z", "-uall"]);
  if (status.code !== 0) throw new Error(`git status 실패(${status.code}): ${copy}`);
  const parts = status.stdout.split("\0");
  const paths = new Set<string>();
  const renamedFrom = new Set<string>();
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i] ?? "";
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    paths.add(entry.slice(3));
    if (xy.includes("R") || xy.includes("C")) {
      const from = parts[i + 1] ?? "";
      i += 1;
      if (xy.includes("R") && from !== "") renamedFrom.add(from);
    }
  }
  for (const f of renamedFrom) paths.add(f);

  const changes: FileChange[] = [];
  for (const file of [...paths].sort(byCodeUnit)) {
    const abs = path.join(copy, file);
    const before = await headContent(copy, file);
    if (!(await present(abs))) {
      if (before !== null) changes.push({ file, status: "deleted", before, after: null });
      continue;
    }
    changes.push({ file, status: before === null ? "added" : "modified", before, after: await readText(abs) });
  }
  return changes;
}

/**
 * replay 배치: `<dir>/<condition>/<promptId>/<rep>/files/<file>`(added·modified의 after) + `run.json`.
 * 같은 실행 디렉터리가 있으면 먼저 비운다.
 */
export async function writeOutputs(
  dir: string,
  condition: Condition,
  promptId: string,
  rep: number,
  changes: FileChange[],
  run: Omit<RunRecord, "prompt" | "condition" | "rep" | "score">,
): Promise<void> {
  const repDir = path.join(dir, condition, promptId, String(rep));
  await fs.rm(repDir, { recursive: true, force: true });
  await fs.mkdir(repDir, { recursive: true });
  for (const c of changes) {
    if (c.status === "deleted" || c.after === null) continue;
    const target = path.join(repDir, "files", c.file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, c.after);
  }
  const deleted = changes.filter((c) => c.status === "deleted").map((c) => c.file);
  const body = {
    status: run.status,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    agentMeta: run.agentMeta,
    harnessPathSeen: run.harnessPathSeen,
    deleted,
  };
  await fs.writeFile(path.join(repDir, "run.json"), `${JSON.stringify(body, null, 2)}\n`);
}

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(root, r)));
    else if (e.isFile()) out.push(r);
  }
  return out.sort(byCodeUnit);
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch {
    return null;
  }
}

function toNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toMeta(v: unknown): AgentMeta | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  return v as AgentMeta;
}

/**
 * replay 읽기: `files/` 아래 파일 = after. before는 base.dir의 같은 경로(있으면 modified, 없으면 added).
 * run.json이 없으면 status "replay", 나머지 null. 실행 디렉터리가 없으면 status "missing"(변경 없음).
 */
export async function readReplay(
  dir: string,
  base: Base,
  condition: Condition,
  promptId: string,
  rep: number,
): Promise<{ changes: FileChange[]; run: Partial<RunRecord> }> {
  const repDir = path.join(dir, condition, promptId, String(rep));
  try {
    if (!(await fs.stat(repDir)).isDirectory()) throw new Error("not a directory");
  } catch {
    return { changes: [], run: { status: "missing", exitCode: null, durationMs: null, agentMeta: null, harnessPathSeen: false } };
  }

  const changes: FileChange[] = [];
  for (const file of await walk(path.join(repDir, "files"))) {
    const after = await readText(path.join(repDir, "files", file));
    const before = await readOptional(path.join(base.dir, file));
    changes.push({ file, status: before === null ? "added" : "modified", before, after });
  }

  const raw = await readOptional(path.join(repDir, "run.json"));
  let parsed: Record<string, unknown> = {};
  if (raw !== null) {
    try {
      const v: unknown = JSON.parse(raw);
      if (typeof v === "object" && v !== null && !Array.isArray(v)) parsed = v as Record<string, unknown>;
    } catch {
      throw new Error(`run.json을 읽을 수 없습니다: ${path.join(repDir, "run.json")}`);
    }
  }
  const deleted = Array.isArray(parsed.deleted) ? parsed.deleted.filter((x): x is string => typeof x === "string") : [];
  for (const file of deleted) changes.push({ file, status: "deleted", before: await readOptional(path.join(base.dir, file)), after: null });
  changes.sort((a, b) => byCodeUnit(a.file, b.file));

  const recorded = RUN_STATUSES.find((s) => s === parsed.status);
  return {
    changes,
    run: {
      status: recorded ?? "replay",
      exitCode: toNumber(parsed.exitCode),
      durationMs: toNumber(parsed.durationMs),
      agentMeta: toMeta(parsed.agentMeta),
      harnessPathSeen: parsed.harnessPathSeen === true,
    },
  };
}
