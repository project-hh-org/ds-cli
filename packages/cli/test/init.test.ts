import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDetect, writeDetect } from "@dsmith-dev/detect";
import type { InitResult } from "@dsmith-dev/init";
import { runAudit } from "../src/commands/audit.js";
import { runInitCommand } from "../src/commands/init.js";
import { buildProgram } from "../src/program.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const bin = path.resolve(here, "../dist/bin.js");

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-init-cli-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** examples/legacy-demo 복사본을 audit하고 상태 0으로 강제한 뒤 다시 audit한다 */
async function legacyDemoState0(): Promise<string> {
  const dest = path.join(tmp, "legacy-demo");
  fs.cpSync(path.join(repoRoot, "examples", "legacy-demo"), dest, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes(".dsmith"),
  });
  await runAudit(dest);
  const current = await readDetect(dest);
  if (current === null) throw new Error("detect.json 없음");
  await writeDetect(dest, { ...current, overrides: { ds: { kind: "none", tokenFiles: [] }, state: 0 } });
  await runAudit(dest);
  return dest;
}

const cli = (args: string[]): ReturnType<typeof spawnSync> =>
  spawnSync(process.execPath, [bin, ...args], { encoding: "utf-8" });

describe("dsmith init", () => {
  it("옵션이 등록돼 있다", () => {
    const init = buildProgram().commands.find((c) => c.name() === "init");
    expect(init?.options.map((o) => o.long).sort()).toEqual(
      ["--all", "--dry-run", "--force", "--json", "--out", "--root", "--top"].sort(),
    );
  });

  it("audit 없이 실행하면 안내 에러", async () => {
    await expect(runInitCommand({ root: tmp })).rejects.toThrow("먼저 `dsmith audit`");
  });

  it("--top은 1 이상의 정수이고 --all과 함께 쓴다", async () => {
    const root = await legacyDemoState0();
    await expect(runInitCommand({ root, all: true, top: "0" })).rejects.toThrow("--top");
    await expect(runInitCommand({ root, all: true, top: "x" })).rejects.toThrow("--top");
    await expect(runInitCommand({ root, top: "3" })).rejects.toThrow("--all");
  });

  it("--json 출력은 InitResult 그대로이고 사람용 요약은 같은 숫자를 쓴다", async () => {
    const root = await legacyDemoState0();
    const r = cli(["init", "--root", root, "--all", "--json"]);
    expect(r.status).toBe(0);
    const result = JSON.parse(r.stdout as string) as InitResult;
    expect(result.tokens.color).toBe(6);
    expect(result.coverage.total).toBeGreaterThan(0);
    expect(result.scaffolds.map((s) => s.name)).toEqual(["Button", "Badge"]);
    expect(result.dryRun).toBe(false);
    expect(fs.existsSync(path.join(root, result.report as string))).toBe(true);

    const human = cli(["init", "--root", root, "--all"]);
    expect(human.status).toBe(0);
    const text = human.stdout as string;
    expect(text).toContain(`색 ${result.tokens.color} · 간격 ${result.tokens.spacing}`);
    expect(text).toContain(`병합된 원값 ${result.tokens.mergedValues}`);
    expect(text).toContain(`하드코딩 ${result.coverage.total}건 중 치환 가능 ${result.coverage.replaceable}건`);
    expect(text).toContain(`같은 값/정확 ${result.coverage.byConfidence.exact}건은 migrate 기본, 근사 ${result.coverage.byConfidence.close}건은 --close`);
    expect(result.tokensLoaded).toEqual({ css: false, evidence: null });
    expect(text).toContain("토큰 스타일시트가 로드되지 않음: design-system/tokens.css를");
    expect(text).toContain("스캐폴드: 생성 0 · 유지 2 · 건너뜀 0");
  });

  it("--dry-run --json: outcomes에 diff, report null, 아무것도 쓰지 않는다", async () => {
    const root = await legacyDemoState0();
    const r = cli(["init", "--root", root, "--all", "--dry-run", "--json"]);
    expect(r.status).toBe(0);
    const result = JSON.parse(r.stdout as string) as InitResult;
    expect(result.dryRun).toBe(true);
    expect(result.report).toBeNull();
    expect(result.outcomes.every((o) => typeof o.diff === "string")).toBe(true);
    expect(fs.existsSync(path.join(root, "design-system"))).toBe(false);
  });

  it("--out과 --top", async () => {
    const root = await legacyDemoState0();
    const r = cli(["init", "--root", root, "--all", "--top", "1", "--out", "src/ds", "--json"]);
    expect(r.status).toBe(0);
    const result = JSON.parse(r.stdout as string) as InitResult;
    expect(result.outDir).toBe("src/ds");
    expect(result.scaffolds.map((s) => s.name)).toEqual(["Button"]);
    expect(fs.existsSync(path.join(root, "src/ds/tokens.css"))).toBe(true);
  });

  it("--out이 레포 밖이면 실패(exit 1)", async () => {
    const root = await legacyDemoState0();
    const r = cli(["init", "--root", root, "--out", "../x"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr as string).toContain("--out");
  });
});
