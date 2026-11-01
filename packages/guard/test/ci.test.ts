import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GUARD_FILE, readGuardSnapshotSync } from "@dsmith-dev/core";
import { COMMENT_MARKER, runGuardCi, type GuardCiResult } from "../src/index.js";
import { ALL, baseRepo, cleanupTmps, cloneRepo, commitAll, git, keep, monoRepo, read, write } from "./helpers.js";

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

type Snap = { policy: { failOn: { newHardcoded: number; deprecated: number }; allow: { files: string[] } }; exclude: string[]; tokenFiles: { file: string }[] };
function editSnapshot(root: string, fn: (s: Snap) => void): void {
  const file = path.join(root, GUARD_FILE);
  const snap = JSON.parse(fs.readFileSync(file, "utf-8")) as Snap;
  fn(snap);
  fs.writeFileSync(file, `${JSON.stringify(snap, null, 2)}\n`);
}

/** base 복사 → (onBase면 main에 먼저 커밋) → feat 브랜치 → edit → 커밋 */
function branch(edit: (root: string) => void, onBase?: (root: string) => void): string {
  const root = cloneRepo(base);
  if (onBase !== undefined) {
    onBase(root);
    commitAll(root, "base 정책");
  }
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

  it("base(main)에 커밋된 policy failOn.newHardcoded: 5면 2건이어도 exitCode 0", async () => {
    const root = branch((r) => write(r, "src/components/Extra.tsx", EXTRA), (r) => editSnapshot(r, (s) => (s.policy.failOn.newHardcoded = 5)));
    const res = await run(root);
    expect(res.counts.newHardcoded).toBe(2);
    expect(res.exitCode).toBe(0);
    expect(res.policyChanged).toBe(false);
    expect(res.body).not.toContain("이 PR이 guard 정책을 바꿉니다");
    expect(res.body).toContain("| 하드코딩 스타일 | 2 (토큰으로 바꿀 수 있음 ");
    expect(res.body).toMatch(/\| 5 \|/);
  });

  it("PR이 failOn.newHardcoded를 5로 풀어도 merge-base 정책(0)으로 판정하고 본문에 알린다", async () => {
    const root = branch((r) => {
      write(r, "src/components/Extra.tsx", EXTRA);
      editSnapshot(r, (s) => (s.policy.failOn.newHardcoded = 5));
    });
    const res = await run(root);
    expect(res.counts.newHardcoded).toBe(2);
    expect(res.exitCode).toBe(1);
    expect(res.policyChanged).toBe(true);
    expect(res.body).toContain("> ℹ 이 PR이 guard 정책을 바꿉니다 (기준: merge-base 정책 적용)");
    expect(res.body).toContain("| 하드코딩 스타일 | 2 (토큰으로 바꿀 수 있음 ");
    expect(res.body).toMatch(/\| 0 \|/);
  });

  it("PR이 allow.files·exclude에 경로를 더해도 그 파일을 계속 검사한다", async () => {
    const root = branch((r) => {
      write(r, "src/legacy/Old.tsx", EXTRA);
      editSnapshot(r, (s) => {
        s.policy.allow.files = ["src/legacy/**"];
        s.exclude.push("src/legacy/**");
      });
    });
    const res = await run(root);
    expect(res.files).toEqual(["src/legacy/Old.tsx"]);
    expect(res.counts.newHardcoded).toBe(2);
    expect(res.exitCode).toBe(1);
    expect(res.policyChanged).toBe(true);
  });

  it("merge-base에 guard.json이 없으면(첫 guard PR) head 정책을 쓰고 정책 변경 문구도 없다", async () => {
    const root = cloneRepo(base);
    const saved = read(root, GUARD_FILE);
    fs.rmSync(path.join(root, GUARD_FILE));
    commitAll(root, "guard.json 없는 base");
    git(root, "switch", "-q", "-c", "feat");
    const snap = JSON.parse(saved) as { policy: { failOn: { newHardcoded: number } } };
    snap.policy.failOn.newHardcoded = 5;
    write(root, GUARD_FILE, `${JSON.stringify(snap, null, 2)}\n`);
    write(root, "src/components/Extra.tsx", EXTRA);
    commitAll(root, "feat");
    const res = await run(root);
    expect(res.counts.newHardcoded).toBe(2);
    expect(res.exitCode).toBe(0);
    expect(res.policyChanged).toBe(false);
    expect(res.body).not.toContain("이 PR이 guard 정책을 바꿉니다");
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
    const root = branch(
      (r) => {
        write(r, "legacy/Old.tsx", EXTRA);
        write(r, "src/components/Extra.tsx", EXTRA);
      },
      (r) => editSnapshot(r, (s) => (s.policy.allow.files = ["legacy/**"])),
    );
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

describe("runGuardCi — 하위 디렉터리 root·이름 바꾼 파일", () => {
  it("모노레포 apps/web을 root로 주면 root 상대 경로로 변경 파일을 읽고 신규 2건을 센다", async () => {
    const { top, root } = monoRepo(base);
    git(top, "switch", "-q", "-c", "feat");
    write(root, "src/components/Extra.tsx", EXTRA);
    write(top, "apps/other/Other.tsx", EXTRA); // root 밖 변경은 보지 않는다
    commitAll(top, "feat");
    const res = await run(root);
    expect(res.files).toEqual(["src/components/Extra.tsx"]);
    expect(res.counts.newHardcoded).toBe(2);
    expect(res.exitCode).toBe(1);
  });

  it("모노레포: 기존 하드코딩이 있는 파일을 고치면 base(하위 경로)와 비교해 신규만 센다", async () => {
    const { top, root } = monoRepo(base);
    git(top, "switch", "-q", "-c", "feat");
    const file = "src/components/KpiCard.tsx";
    write(root, file, `// 주석\n${read(root, file)}`);
    commitAll(top, "feat");
    const res = await run(root);
    expect(res.files).toEqual([file]);
    expect(res.counts.newHardcoded).toBe(0);
    expect(res.exitCode).toBe(0);
  });

  it("순수 git mv는 신규 0건(옛 경로의 base와 비교)", async () => {
    const root = branch((r) => {
      fs.mkdirSync(path.join(r, "src/components/kpi"), { recursive: true });
      git(r, "mv", "src/components/KpiCard.tsx", "src/components/kpi/KpiCard.tsx");
    });
    const res = await run(root);
    expect(res.files).toEqual(["src/components/kpi/KpiCard.tsx"]);
    expect(res.counts.newHardcoded).toBe(0);
    expect(res.exitCode).toBe(0);
  });

  it("이름을 바꾸고 색 하나를 더하면 그 하나만 신규", async () => {
    const root = branch((r) => {
      fs.mkdirSync(path.join(r, "src/components/kpi"), { recursive: true });
      git(r, "mv", "src/components/KpiCard.tsx", "src/components/kpi/KpiCard.tsx");
      const moved = "src/components/kpi/KpiCard.tsx";
      write(r, moved, read(r, moved).replace("minWidth: 200", 'minWidth: 200, backgroundColor: "#12ab34"'));
    });
    const res = await run(root);
    expect(res.counts.newHardcoded).toBe(1);
    expect(res.newFindings[0]?.style?.raw).toBe("#12ab34");
    expect(res.exitCode).toBe(1);
  });
});

describe("runGuardCi — 파싱 실패·새 토큰 파일", () => {
  it("파싱하지 못한 head 파일은 files에 세고 본문에 파싱 실패 N건으로 적는다", async () => {
    const root = branch((r) => write(r, "src/components/Broken.tsx", "export const A = () => <div style={{ color: \n"));
    const res = await run(root);
    expect(res.files).toEqual(["src/components/Broken.tsx"]);
    expect(res.parseFailed).toEqual(["src/components/Broken.tsx"]);
    expect(res.body).toContain("파싱 실패 1건");
    expect(res.body).toContain("`src/components/Broken.tsx`");
  });

  it("스냅샷에 없는 토큰 파일은 staleSnapshot에 +파일로 들어간다", async () => {
    const root = branch(
      (r) => write(r, "src/components/Extra.tsx", EXTRA),
      (r) => editSnapshot(r, (s) => (s.tokenFiles = s.tokenFiles.filter((t) => t.file !== "tailwind.config.ts"))),
    );
    const res = await run(root);
    expect(res.staleSnapshot).toEqual(["+tailwind.config.ts"]);
    expect(res.body).toContain("> ⚠ 토큰 파일이 guard.json보다 새것입니다");
    expect(res.body).toContain("+tailwind.config.ts");
  });
});
