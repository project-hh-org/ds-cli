import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GUARD_FILE, extractorMatchers, readGuardSnapshotSync } from "@dsmith-dev/core";
import { runGuardCi, type GuardCiResult } from "@dsmith-dev/guard";
import { extractorsFor } from "../src/extractors.js";
import { scoreRun, type FileChange } from "../src/score.js";
import { PROBE, cleanupTmps, copyRepo, dsmith, git } from "./helpers.js";

/**
 * 같은 엔진 교차 검사: 같은 레포·같은 스냅샷·같은 변경에 대해 guard --ci의 신규 판정 수 = scoreRun의 수.
 * (규칙을 벤치마크 쪽에서 다시 구현하지 않았다는 증거)
 */

const NON_DS = `function Button() {\n  return <button />;\n}\nexport const NonDs = () => <Button />;\n`;
const LOCAL_BUTTON_PAGE_EDIT = (src: string): string => src.replace('<div className="space-y-6">\n', '<div className="space-y-6">\n      <p style={{ color: "#e11d48" }}>주의</p>\n');

let root: string;
let guard: GuardCiResult;
let changes: FileChange[];
let score: ReturnType<typeof scoreRun>;

beforeAll(async () => {
  root = copyRepo("examples/legacy-demo");
  // legacy-demo에는 .tsx가 있어 guard init이 설정을 고치려면 TS 파서가 설정에 보여야 한다(e2e-migrate-guard와 같음)
  fs.writeFileSync(path.join(root, "eslint.config.mjs"), 'import tseslint from "typescript-eslint";\n\nexport default [\n  tseslint.configs.base,\n  { rules: {} },\n];\n');
  fs.writeFileSync(path.join(root, ".gitignore"), ".dsmith/*\n!.dsmith/guard.json\n");
  dsmith(root, "audit");
  dsmith(root, "init", "--all");
  dsmith(root, "ai");
  dsmith(root, "guard", "init");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Dahee Hwang");
  git(root, "config", "user.email", "dahee@project-hh.com");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");

  git(root, "switch", "-q", "-c", "feat");
  const page = "app/page.tsx";
  const pageBefore = fs.readFileSync(path.join(root, page), "utf-8");
  const pageAfter = LOCAL_BUTTON_PAGE_EDIT(pageBefore);
  expect(pageAfter).not.toBe(pageBefore);
  fs.writeFileSync(path.join(root, page), pageAfter);
  fs.writeFileSync(path.join(root, "src/components/Probe.tsx"), PROBE);
  fs.writeFileSync(path.join(root, "src/components/NonDs.tsx"), NON_DS);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "feat");

  guard = await runGuardCi({ root, base: "main", extractors: extractorsFor(readGuardSnapshotSync(path.join(root, GUARD_FILE)).extractors) });

  const snapshot = readGuardSnapshotSync(path.join(root, GUARD_FILE));
  const extractors = extractorsFor(snapshot.extractors);
  for (const e of extractors) await e.prepare?.(root);
  changes = [
    { file: page, status: "modified", before: pageBefore, after: pageAfter },
    { file: "src/components/NonDs.tsx", status: "added", before: null, after: NON_DS },
    { file: "src/components/Probe.tsx", status: "added", before: null, after: PROBE },
  ];
  score = scoreRun({ root, snapshot, matchers: extractorMatchers(extractors, { dot: true }), changes, expectedFile: "src/components/Probe.tsx" });
}, 180_000);

afterAll(cleanupTmps);

describe("scoreRun == guard --ci", () => {
  it("guard가 본 파일 = 채점한 파일", () => {
    expect(guard.files).toEqual(score.files.map((f) => f.file));
    expect(guard.parseFailed).toEqual([]);
  });

  it("신규 하드코딩·치환 가능·DS 외·deprecated 수가 같다", () => {
    expect(score.totals.hardcoded).toBe(guard.counts.newHardcoded);
    expect(score.totals.replaceable).toBe(guard.counts.newReplaceable);
    expect(score.totals.nonDs).toBe(guard.counts.newNonDs);
    expect(score.totals.deprecated).toBe(guard.counts.newDeprecated);
  });

  it("비교가 자명하지 않다 — 새 하드코딩 4건(프로브 3 + 수정 1), DS 외 1건", () => {
    expect(guard.counts.newHardcoded).toBe(4);
    expect(guard.counts.newNonDs).toBe(1);
  });

  it("finding 목록의 파일별 수도 같다", () => {
    for (const f of score.files) {
      const hardcoded = guard.newFindings.filter((n) => n.file === f.file && n.rule === "no-hardcoded-style").length;
      const nonDs = guard.newFindings.filter((n) => n.file === f.file && n.rule === "prefer-ds-component").length;
      expect({ file: f.file, hardcoded: f.introduced.hardcoded, nonDs: f.nonDs }).toEqual({ file: f.file, hardcoded, nonDs });
    }
  });
});
