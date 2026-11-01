import type { Catalog, CatalogComponent, CatalogSource } from "@dsmith-dev/core";

/** 스펙 §3 예약 마커 — install의 `<!-- dsmith:start -->`와 별개 블록 */
export const DS_MARKERS = { start: "<!-- dsmith:ds:start -->", end: "<!-- dsmith:ds:end -->" } as const;

/**
 * 섹션에 적는 MCP 도구 이름. catalog → mcp-server 의존을 피하려고 상수로 둔다
 * (mcp-server의 TOOL_NAMES와 같은지는 Task 8 일관성 테스트가 대조).
 */
export const MCP_TOOL_NAMES_IN_SECTION: readonly string[] = [
  "resolve_token",
  "lint_snippet",
  "search_component",
  "get_component",
  "explain_decision",
  "list_decisions",
];

export const SECTION_MAX_LINES = 80;

const TOP_COMPONENTS = 20;
const MAX_DEPRECATED = 10;
const MAX_TOKEN_FILES = 3;
const DEPRECATED_NOTE_MAX = 80;

/** 마커 모양·줄바꿈이 본문에 섞이지 않게 한 줄로 만든다 */
function oneLine(text: string, max?: number): string {
  let s = text.replace(/<!--|-->/g, "").replace(/\s+/g, " ").trim();
  if (max !== undefined && s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

function tick(s: string): string {
  return `\`${oneLine(s).replace(/`/g, "'")}\``;
}

function sourceLabel(s: CatalogSource): string {
  if (s.origin === "ds-npm") {
    const name = s.packageName ?? "(알 수 없음)";
    return `${tick(s.packageVersion === undefined ? name : `${name}@${s.packageVersion}`)} (npm)`;
  }
  if (s.origin === "init") {
    const dir = (s.dir ?? "design-system/components").replace(/\/components$/, "");
    return `${tick(`${dir === "components" ? "." : dir}/`)} (dsmith init 초안)`;
  }
  return `${tick(s.dir ?? ".")} (로컬)`;
}

/** init 산출 소스의 산출 디렉터리("design-system/components" → "design-system") */
function initDirOf(s: CatalogSource): string {
  return (s.dir ?? "design-system/components").replace(/\/components$/, "");
}

function tokenLine(catalog: Catalog): string | null {
  const files = [...new Set(catalog.tokens.map((t) => t.file).filter((f) => f !== ""))];
  const initSources = catalog.sources.filter((s) => s.origin === "init");
  if (files.length === 0) {
    // npm DS는 토큰 파일이 없는 게 정상이다 — init을 권하지 않는다.
    if (catalog.sources.some((s) => s.origin === "ds-npm")) return null;
    return "- 토큰 파일: 없음 — `dsmith init`으로 초안 생성";
  }
  const shown = files.slice(0, MAX_TOKEN_FILES).map(tick).join(", ");
  const more = files.length > MAX_TOKEN_FILES ? ` 외 ${files.length - MAX_TOKEN_FILES}개` : "";
  // init 산출은 같은 디렉터리에 CSS 변수 파일(tokens.css)도 있다 — 코드에서는 이쪽을 쓴다.
  const css = initSources.map((s) => {
    const dir = initDirOf(s);
    return tick(dir === "components" || dir === "." ? "tokens.css" : `${dir}/tokens.css`);
  });
  const cssNote = css.length > 0 ? ` · CSS 변수: ${[...new Set(css)].join(", ")}` : "";
  return `- 토큰 파일: ${shown}${more} (토큰 ${catalog.tokens.length}개)${cssNote}`;
}

function orderedNames(components: CatalogComponent[], usageOrder: string[]): string[] {
  const known = new Set(components.map((c) => c.name));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of [...usageOrder, ...components.map((c) => c.name)]) {
    if (known.has(name) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** 마커 사이에 들어갈 본문(마커 제외, ≤80줄, 결정적: 타임스탬프·절대 경로 없음). usageOrder = 사용 수 순 컴포넌트 이름 */
export function renderAgentsDsSection(catalog: Catalog, usageOrder: string[]): string {
  const lines: string[] = [];
  lines.push("## 이 레포의 디자인 시스템 (dsmith ai가 생성 — 직접 고치면 다음 ai가 덮어쓰지 않음)", "");

  lines.push(
    catalog.sources.length === 0
      ? "- DS 위치: 찾지 못함"
      : `- DS 위치: ${catalog.sources.map(sourceLabel).join(" · ")}`,
  );
  const tokens = tokenLine(catalog);
  if (tokens !== null) lines.push(tokens);

  const names = orderedNames(catalog.components, usageOrder);
  const top = names.slice(0, TOP_COMPONENTS);
  const label = names.length > TOP_COMPONENTS ? `많이 쓰는 순 상위 ${TOP_COMPONENTS}` : "많이 쓰는 순";
  lines.push(
    top.length === 0
      ? `- 컴포넌트 0개`
      : `- 컴포넌트 ${catalog.stats.components}개(props 추출 ${catalog.stats.propsOk}) — ${label}: ${top.join(", ")}`,
  );

  const deprecated = catalog.components.filter((c) => c.deprecated !== undefined);
  if (deprecated.length > 0) {
    const shown = deprecated.slice(0, MAX_DEPRECATED).map((c) => {
      const note = oneLine(c.deprecated ?? "", DEPRECATED_NOTE_MAX);
      return note === "" ? c.name : `${c.name} — ${note}`;
    });
    const more = deprecated.length > MAX_DEPRECATED ? ` 외 ${deprecated.length - MAX_DEPRECATED}개` : "";
    lines.push(`- 쓰지 말 것(deprecated): ${shown.join("; ")}${more}`);
  }

  lines.push(
    "",
    "### 규칙",
    catalog.tokens.length > 0
      ? "1. 색·간격·모서리·글꼴 크기 값을 하드코딩하지 않는다. 토큰 파일의 변수를 쓴다."
      : "1. 토큰 파일이 있으면 색·간격·모서리·글꼴 크기 값을 하드코딩하지 않고 그 변수를 쓴다.",
    "2. 값이 필요하면 MCP `resolve_token`으로 가장 가까운 토큰을 찾는다.",
    "3. 새 UI는 위 컴포넌트를 먼저 쓴다. 고르기 전에 `search_component`·`get_component`로 props를 확인한다.",
    "4. deprecated 컴포넌트·props는 쓰지 않는다.",
    "5. 끝나면 `/ds-check`(또는 MCP `lint_snippet`)로 검사한다.",
    "",
    `MCP 서버 \`dsmith\` 도구: ${MCP_TOOL_NAMES_IN_SECTION.join(", ")} — 등록은 \`npx dsmith install\`.`,
  );

  if (lines.length > SECTION_MAX_LINES) throw new Error(`AGENTS.md DS 섹션이 ${SECTION_MAX_LINES}줄을 넘음`);
  return `${lines.join("\n")}\n`;
}
