import { COMMENT_MARKER } from "./comment.js";
import type { GuardCiResult } from "./ci.js";

export interface PrContext {
  apiUrl: string;
  /** owner/repo */
  repo: string;
  number: number;
  token: string;
}

const DEFAULT_API_URL = "https://api.github.com";

/** env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH(JSON의 pull_request.number), GITHUB_API_URL(기본 https://api.github.com). 하나라도 없으면 { error } */
export function prContextFromEnv(env: Record<string, string | undefined>, readFile: (p: string) => string): PrContext | { error: string } {
  const token = env["GITHUB_TOKEN"];
  const repo = env["GITHUB_REPOSITORY"];
  const eventPath = env["GITHUB_EVENT_PATH"];
  const missing = [
    token ? null : "GITHUB_TOKEN",
    repo ? null : "GITHUB_REPOSITORY",
    eventPath ? null : "GITHUB_EVENT_PATH",
  ].filter((n): n is string => n !== null);
  if (missing.length > 0 || !token || !repo || !eventPath) return { error: `GitHub 환경 변수가 없습니다: ${missing.join(", ")}` };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { error: `GITHUB_REPOSITORY 형식이 올바르지 않습니다: ${repo}` };
  let number: unknown;
  try {
    const event = JSON.parse(readFile(eventPath)) as { pull_request?: { number?: unknown } };
    number = event.pull_request?.number;
  } catch (err) {
    return { error: `GITHUB_EVENT_PATH를 읽을 수 없습니다: ${(err as Error).message}` };
  }
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) return { error: "pull_request 이벤트가 아니라 PR 번호를 알 수 없습니다" };
  return { apiUrl: (env["GITHUB_API_URL"] || DEFAULT_API_URL).replace(/\/+$/, ""), repo, number, token };
}

type Comment = GuardCiResult["comment"];

interface ApiComment {
  id: number;
  body?: string | null;
}

const MAX_PAGES = 100;

async function fail(res: Response): Promise<{ status: "failed"; reason: string }> {
  let message = res.statusText;
  try {
    const data = (await res.json()) as { message?: unknown };
    if (typeof data.message === "string" && data.message !== "") message = data.message;
  } catch {
    // 본문이 JSON이 아님 — statusText 사용
  }
  return { status: "failed", reason: `${res.status} ${message}`.trim() };
}

/**
 * 마커가 든 첫 코멘트를 찾아 본문이 같으면 unchanged, 다르면 PATCH; 없으면 createIfClean이 false이고 신규가 없을 때 skipped, 아니면 POST.
 * 어떤 오류도 던지지 않고 { status: "failed", reason }으로 돌려준다.
 */
export async function upsertComment(
  ctx: PrContext,
  body: string,
  opts: { fetchImpl: typeof fetch; createIfClean: boolean },
): Promise<NonNullable<Comment>> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${ctx.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const base = `${ctx.apiUrl}/repos/${ctx.repo}`;
  try {
    let found: ApiComment | null = null;
    for (let page = 1; found === null && page <= MAX_PAGES; page += 1) {
      const res = await opts.fetchImpl(`${base}/issues/${ctx.number}/comments?per_page=100&page=${page}`, { headers });
      if (!res.ok) return await fail(res);
      const items = (await res.json()) as ApiComment[];
      if (!Array.isArray(items) || items.length === 0) break;
      found = items.find((c) => typeof c.body === "string" && c.body.includes(COMMENT_MARKER)) ?? null;
    }

    const json = { ...headers, "Content-Type": "application/json" };
    if (found !== null) {
      if (found.body === body) return { status: "unchanged" };
      const res = await opts.fetchImpl(`${base}/issues/comments/${found.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ body }) });
      return res.ok ? { status: "updated" } : await fail(res);
    }
    if (!opts.createIfClean) return { status: "skipped", reason: "신규 지적이 없고 기존 코멘트도 없음" };
    const res = await opts.fetchImpl(`${base}/issues/${ctx.number}/comments`, { method: "POST", headers: json, body: JSON.stringify({ body }) });
    return res.ok ? { status: "created" } : await fail(res);
  } catch (err) {
    return { status: "failed", reason: (err as Error).message };
  }
}
