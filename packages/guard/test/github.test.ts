import { describe, expect, it } from "vitest";
import { COMMENT_MARKER } from "../src/comment.js";
import { prContextFromEnv, upsertComment, type PrContext } from "../src/github.js";

const ctx: PrContext = { apiUrl: "https://api.github.com", repo: "o/r", number: 7, token: "tok" };
const body = `${COMMENT_MARKER}\n### dsmith guard\n`;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(routes: (call: Call) => { status: number; json: unknown }): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    };
    calls.push(call);
    const { status, json } = routes(call);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("upsertComment", () => {
  it("마커 코멘트가 없으면 POST 한 번", async () => {
    const { fetchImpl, calls } = fakeFetch((c) =>
      c.method === "GET" ? { status: 200, json: c.url.includes("page=1") ? [{ id: 1, body: "다른 코멘트" }] : [] } : { status: 201, json: { id: 9 } },
    );
    const res = await upsertComment(ctx, body, { fetchImpl, createIfClean: true });
    expect(res).toEqual({ status: "created" });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe("https://api.github.com/repos/o/r/issues/7/comments");
    expect(JSON.parse(posts[0]?.body ?? "{}")).toEqual({ body });
    expect(posts[0]?.headers["Authorization"]).toBe("Bearer tok");
    expect(posts[0]?.headers["Accept"]).toBe("application/vnd.github+json");
    expect(calls[0]?.url).toBe("https://api.github.com/repos/o/r/issues/7/comments?per_page=100&page=1");
  });

  it("2페이지째에 마커가 있으면 그 id를 PATCH", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: `c${i}` }));
    const { fetchImpl, calls } = fakeFetch((c) => {
      if (c.method === "GET") return { status: 200, json: c.url.endsWith("page=1") ? page1 : c.url.endsWith("page=2") ? [{ id: 555, body: `${COMMENT_MARKER}\n옛 본문` }] : [] };
      return { status: 200, json: {} };
    });
    const res = await upsertComment(ctx, body, { fetchImpl, createIfClean: false });
    expect(res).toEqual({ status: "updated" });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe("https://api.github.com/repos/o/r/issues/comments/555");
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ body });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("같은 본문이면 unchanged — GET만", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, json: [{ id: 3, body }] }));
    expect(await upsertComment(ctx, body, { fetchImpl, createIfClean: false })).toEqual({ status: "unchanged" });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("마커를 인용만 한 사람의 코멘트는 건드리지 않고(본문 맨 앞이 마커일 때만 우리 것) 새로 POST", async () => {
    const quoted = { id: 9, body: `이 봇은 이렇게 답해요:\n> ${COMMENT_MARKER}\n> ...` };
    const { fetchImpl, calls } = fakeFetch((c) => (c.method === "GET" ? { status: 200, json: [quoted] } : { status: 201, json: {} }));
    expect(await upsertComment(ctx, body, { fetchImpl, createIfClean: true })).toEqual({ status: "created" });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    const ours = fakeFetch((c) => (c.method === "GET" ? { status: 200, json: [{ id: 4, body: `\n${COMMENT_MARKER}\n옛 본문` }] } : { status: 200, json: {} }));
    expect(await upsertComment(ctx, body, { fetchImpl: ours.fetchImpl, createIfClean: true })).toEqual({ status: "updated" });
  });

  it("코멘트가 없고 신규도 없으면 skipped(요청은 GET만)", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 200, json: [] }));
    const res = await upsertComment(ctx, body, { fetchImpl, createIfClean: false });
    expect(res.status).toBe("skipped");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("403은 failed(예외 없음) — 이유에 상태와 메시지", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 403, json: { message: "Resource not accessible by integration" } }));
    const res = await upsertComment(ctx, body, { fetchImpl, createIfClean: true });
    expect(res).toEqual({ status: "failed", reason: "403 Resource not accessible by integration" });
  });

  it("POST/PATCH가 403이어도 failed, 네트워크 예외도 failed", async () => {
    const posted = fakeFetch((c) => (c.method === "GET" ? { status: 200, json: [] } : { status: 403, json: { message: "forbidden" } }));
    expect((await upsertComment(ctx, body, { fetchImpl: posted.fetchImpl, createIfClean: true })).status).toBe("failed");
    const boom = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await upsertComment(ctx, body, { fetchImpl: boom, createIfClean: true })).toEqual({ status: "failed", reason: "ECONNRESET" });
  });
});

describe("prContextFromEnv", () => {
  const event = JSON.stringify({ pull_request: { number: 42 } });
  const env = { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_PATH: "/event.json" };

  it("env에서 컨텍스트를 만든다(API URL 기본값)", () => {
    expect(prContextFromEnv(env, () => event)).toEqual({ apiUrl: "https://api.github.com", repo: "o/r", number: 42, token: "t" });
    expect(prContextFromEnv({ ...env, GITHUB_API_URL: "https://ghe.example/api/v3/" }, () => event)).toMatchObject({ apiUrl: "https://ghe.example/api/v3" });
  });

  it("env가 하나라도 없으면 error", () => {
    for (const key of Object.keys(env)) {
      const partial: Record<string, string | undefined> = { ...env, [key]: undefined };
      const res = prContextFromEnv(partial, () => event);
      expect("error" in res && res.error).toContain(key);
    }
  });

  it("pull_request가 없는 이벤트나 읽기 실패는 error", () => {
    expect("error" in prContextFromEnv(env, () => "{}")).toBe(true);
    expect(
      "error" in
        prContextFromEnv(env, () => {
          throw new Error("ENOENT");
        }),
    ).toBe(true);
  });
});
