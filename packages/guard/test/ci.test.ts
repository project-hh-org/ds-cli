import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GUARD_FILE, readGuardSnapshotSync } from "@dsmith-dev/core";
import { COMMENT_MARKER, runGuardCi, type GuardCiResult } from "../src/index.js";
import { ALL, baseRepo, cleanupTmps, cloneRepo, commitAll, git, keep, read, write } from "./helpers.js";

let base: string;
beforeAll(async () => {
  base = keep((await baseRepo()).root);
}, 120_000);
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
afterEach(cleanupTmps);

const EXTRA = `export const Extra = () => (
  <div style={{ color: "#3c83f7", backgroundColor: "#ef4444" }}>extra</div>
);
`;

/** base 복사 → feat 브랜치 → edit → 커밋 */
function branch(edit: (root: string) => void): string {
  const root = cloneRepo(base);
  git(root, "switch", "-q", "-c", "feat");
  edit(root);
  commitAll(root, "feat");
  return root;
}

const run = (root: string, extra: Partial<Parameters<typeof runGuardCi>[0]> = {}): Promise<GuardCiResult> =>
  runGuardCi({ root, base: "main", extractors: ALL, ...extra });

describe("runGuardCi", () => {
  it("하드코딩 색 2개를 더하면 newHardcoded 2, exitCode 1, 본문에 스냅샷 1건 이상", async () => {
    const root = branch((r) => write(r, "src/components/Extra.tsx", EXTRA));
    const res = await run(root);
    expect(res.files).toEqual(["src/components/Extra.tsx"]);
    expect(res.counts.newHardcoded).toBe(2);
    expect(res.newFindings.map((f) => f.style?.raw).sort()).toEqual(["#3c83f7", "#ef4444"]);
    expect(res.exitCode).toBe(1);
    expect(res.body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(res.body).toContain("신규 하드코딩 2건");
    expect(res.body).toContain("`src/components/Extra.tsx:2`");
    expect(res.body).toContain("| 하드코딩 스타일 | 2 (토큰으로 바꿀 수 있음 ");
    expect(res.comment).toBeNull();
    expect(res.base).toBe("main");
    expect(res.mergeBase).toBe(git(root, "rev-parse", "main").trim());
    expect(res.staleSnapshot).toEqual([]);
  });

  it("값을 var(--토큰)으로 바꾼 커밋은 0건, exitCode 0", async () => {
    const snap = readGuardSnapshotSync(path.join(base, GUARD_FILE));
    const color = snap.tokens.find((t) => t.category === "color");
    if (color === undefined) throw new Error("색 토큰이 없음");
    const code = EXTRA.replaceAll(/"#[0-9a-f]{6}"/g, `"var(${color.name})"`);
    const root = branch((r) => write(r, "src/components/Extra.tsx", code));
    const res = await run(root);
    expect(res.counts.newHardcoded).toBe(0);
    expect(res.exitCode).toBe(0);
    expect(res.files).toEqual(["src/components/Extra.tsx"]);
  });

  it("기존 하드코딩 줄을 아래로 옮기기만 한 커밋은 0건(줄 이동 무관)", async () => {
    const root = branch((r) => {
      const file = "src/components/KpiCard.tsx";
      write(r, file, `// 위에 주석을 더해 아래 줄을 모두 밀어 낸다\n// 한 줄 더\n\n${read(r, file)}`);
    });
    const res = await run(root);
    expect(res.files).toEqual(["src/components/KpiCard.tsx"]);
    expect(res.counts.newHardcoded).toBe(0);
    expect(res.counts.removedHardcoded).toBe(0);
    expect(res.exitCode).toBe(0);
  });

  it("하드코딩 하나를 지우면 removedHardcoded 1, 본문은 줄였습니다", async () => {
    const root = branch((r) => {
      const file = "app/globals.css";
      write(r, file, read(r, file).replace(".danger-text {\n  color: #e53e3e;\n}\n", ""));
    });
    const res = await run(root);
    expect(res.files).toEqual(["app/globals.css"]);
    expect(res.counts).toMatchObject({ newHardcoded: 0, removedHardcoded: 1 });
    expect(res.exitCode).toBe(0);
    expect(res.body).toContain("이 PR이 하드코딩 1건을 줄였습니다");
  });

  it(".css 파일 변경도 검사한다(ESLint가 못 보는 경로)", async () => {
    const root = branch((r) => write(r, "app/globals.css", `${read(r, "app/globals.css")}\n.fresh {\n  color: #12ab34;\n}\n`));
    const res = await run(root);
    expect(res.files).toEqual(["app/globals.css"]);
    expect(res.counts.newHardcoded).toBe(1);
    expect(res.newFindings[0]?.style).toMatchObject({ property: "color", raw: "#12ab34", extractor: "css" });
    expect(res.exitCode).toBe(1);
  });

  it("policy failOn.newHardcoded: 5면 2건이어도 exitCode 0", async () => {
    const root = branch((r) => {
      write(r, "src/components/Extra.tsx", EXTRA);
      const file = path.join(r, GUARD_FILE);
      const snap = JSON.parse(fs.readFileSync(file, "utf-8")) as { policy: { failOn: { newHardcoded: number } } };
      snap.policy.failOn.newHardcoded = 5;
      fs.writeFileSync(file, `${JSON.stringify(snap, null, 2)}\n`);
    });
    const res = await run(root);
    expect(res.counts.newHardcoded).toBe(2);
    expect(res.exitCode).toBe(0);
    expect(res.body).toContain("| 하드코딩 스타일 | 2 (토큰으로 바꿀 수 있음 ");
    expect(res.body).toMatch(/\| 5 \|/);
  });

  it("토큰 파일을 고친 뒤 스냅샷을 갱신하지 않으면 staleSnapshot과 본문 경고", async () => {
    const root = branch((r) => {
      const tokens = path.join(r, "design-system/tokens.css");
      fs.appendFileSync(tokens, "\n/* 손으로 고침 */\n");
      write(r, "src/components/Extra.tsx", EXTRA);
    });
    const res = await run(root);
    expect(res.staleSnapshot).toEqual(["design-system/tokens.css"]);
    expect(res.body).toContain("> ⚠ 토큰 파일이 guard.json보다 새것입니다 — dsmith guard init으로 갱신하세요");
    // 토큰 파일(init 산출 디렉터리)은 검사 대상에서 빠진다
    expect(res.files).toEqual(["src/components/Extra.tsx"]);
  });

  it("snapshot의 exclude·allow.files에 걸리는 변경 파일은 검사하지 않는다", async () => {
    const root = branch((r) => {
      write(r, "legacy/Old.tsx", EXTRA);
      write(r, "src/components/Extra.tsx", EXTRA);
      const file = path.join(r, GUARD_FILE);
      const snap = JSON.parse(fs.readFileSync(file, "utf-8")) as { policy: { allow: { files: string[] } } };
      snap.policy.allow.files = ["legacy/**"];
      fs.writeFileSync(file, `${JSON.stringify(snap, null, 2)}\n`);
    });
    const res = await run(root);
    expect(res.files).toEqual(["src/components/Extra.tsx"]);
    expect(res.counts.newHardcoded).toBe(2);
  });

  it("같은 입력이면 본문이 바이트 단위로 같다(결정적)", async () => {
    const root = branch((r) => write(r, "src/components/Extra.tsx", EXTRA));
    const a = await run(root);
    const b = await run(root);
    expect(a.body).toBe(b.body);
    expect(a.body).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(a.body).not.toContain(root);
  });

  it("base ref가 없으면 fetch-depth 안내가 든 Error", async () => {
    const root = branch((r) => write(r, "src/components/Extra.tsx", EXTRA));
    await expect(run(root, { base: "origin/nope" })).rejects.toThrow(/fetch-depth: 0/);
    await expect(run(root, { base: "origin/nope" })).rejects.toThrow(/--base 브랜치를 fetch했는지 확인/);
    await expect(run(root, { base: "--output=x" })).rejects.toThrow(/--base/);
  });

  it("guard.json이 없으면 guard init 안내 Error", async () => {
    const root = cloneRepo(base);
    fs.rmSync(path.join(root, GUARD_FILE));
    await expect(run(root)).rejects.toThrow("먼저 `dsmith guard init`");
  });

  it("변경이 없으면 파일 0, 신규 0", async () => {
    const root = branch((r) => write(r, "README.md", "# 문서만 바꿈\n"));
    const res = await run(root);
    expect(res.files).toEqual([]);
    expect(res.exitCode).toBe(0);
  });
});

describe("runGuardCi — 코멘트", () => {
  const env = (root: string, number = 5): Record<string, string> => {
    const eventPath = path.join(root, ".dsmith", "event.json");
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number } }));
    return { GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_PATH: eventPath };
  };

  function recorder(handler: (method: string, url: string) => { status: number; json: unknown }) {
    const calls: { method: string; url: string; body?: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(input), ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      const { status, json } = handler(method, String(input));
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it("--comment: 마커 코멘트가 없으면 본문을 POST", async () => {
    const root = branch((r) => write(r, "src/components/Extra.tsx", EXTRA));
    const { fetchImpl, calls } = recorder((m) => (m === "GET" ? { status: 200, json: [] } : { status: 201, json: {} }));
    const res = await run(root, { comment: true, env: env(root), fetchImpl });
    expect(res.comment).toEqual({ status: "created" });
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("https://api.github.com/repos/o/r/issues/5/comments");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ body: res.body });
  });

  it("코멘트 실패(403)·env 누락은 예외 없이 failed, exitCode 불변", async () => {
    const root = branch((r) => write(r, "src/components/Extra.tsx", EXTRA));
    const forbidden = recorder(() => ({ status: 403, json: { message: "Resource not accessible by integration" } }));
    const a = await run(root, { comment: true, env: env(root), fetchImpl: forbidden.fetchImpl });
    expect(a.comment?.status).toBe("failed");
    expect(a.comment?.reason).toContain("403");
    expect(a.exitCode).toBe(1);

    const b = await run(root, { comment: true, env: {}, fetchImpl: forbidden.fetchImpl });
    expect(b.comment?.status).toBe("failed");
    expect(b.comment?.reason).toContain("GITHUB_TOKEN");
    expect(b.exitCode).toBe(1);
    expect(forbidden.calls.length).toBe(forbidden.calls.filter((c) => c.method === "GET").length);
  });

  it("신규·제거가 없고 기존 코멘트도 없으면 skipped(쓰기 요청 없음)", async () => {
    const root = branch((r) => write(r, "README.md", "# 문서\n"));
    const { fetchImpl, calls } = recorder(() => ({ status: 200, json: [] }));
    const res = await run(root, { comment: true, env: env(root), fetchImpl });
    expect(res.comment?.status).toBe("skipped");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("이전에 단 코멘트가 있으면 깨끗해진 뒤에도 갱신한다", async () => {
    const root = branch((r) => write(r, "README.md", "# 문서\n"));
    const { fetchImpl, calls } = recorder((m) => (m === "GET" ? { status: 200, json: [{ id: 77, body: `${COMMENT_MARKER}\n옛 본문` }] } : { status: 200, json: {} }));
    const res = await run(root, { comment: true, env: env(root), fetchImpl });
    expect(res.comment).toEqual({ status: "updated" });
    expect(calls.find((c) => c.method === "PATCH")?.url).toBe("https://api.github.com/repos/o/r/issues/comments/77");
  });
});
