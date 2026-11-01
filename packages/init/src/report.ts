import { TOKENS_NOT_LOADED_NOTE, type DraftCategory, type TokenDraft } from "@dsmith-dev/core";
import type { InitResult } from "./run.js";

const CATEGORY_LABEL: Record<DraftCategory, string> = {
  color: "색",
  spacing: "간격",
  radius: "모서리",
  "font-size": "글꼴 크기",
};

const cell = (s: string): string => s.replace(/\|/g, "\\|");
const pct = (rate: number | null): string => (rate === null ? "해당 없음" : `${(rate * 100).toFixed(1)}%`);

/**
 * `.dsmith/reports/init-<date>.md` 본문. 날짜·절대 경로 없음(파일명만 날짜).
 * 숫자는 모두 `InitResult`(= core `buildTokenDraft`·`draftCoverage`)에서 온다.
 */
export function renderInitReport(r: InitResult, draft: TokenDraft): string {
  const lines: string[] = ["# DS Init", ""];
  lines.push(`- 산출 디렉터리: \`${r.outDir}\``);
  const names = ["tokens.json", "tokens.css", "tokens.ts"];
  const present = names.filter((_, i) => ["created", "updated", "unchanged"].includes(r.outcomes[i]?.status ?? ""));
  lines.push(`- 토큰 파일: ${present.length === 0 ? "없음(쓰지 못함)" : present.map((n) => `\`${n}\``).join(" · ")}`);
  const held = names.filter((n) => !present.includes(n));
  if (present.length > 0 && held.length > 0) {
    lines.push(
      `- 보류·쓰지 못함: ${held.map((n) => `\`${n}\``).join(" · ")} (${r.tokenHold === "invalid" ? "쓸 수 없는 경로 — 경로를 고친 뒤 다시 실행" : "사용자 수정 — `--force`로 덮어씀"})`,
    );
  }
  if (present.length === 0 && r.tokenHold !== null) {
    const why = r.outcomes
      .slice(0, 3)
      .filter((o) => o.status === "skipped-invalid")
      .map((o) => `${o.file}: ${o.reason ?? "경로가 안전하지 않음"}`);
    lines.push(
      r.tokenHold === "invalid"
        ? `- 보류 이유: 쓸 수 없는 경로(${why.join("; ")}) — 경로를 고친 뒤 다시 실행. \`--force\`로도 쓸 수 없음`
        : "- 보류 이유: 사람이 고친 토큰 파일 — `--force`로 덮어씀",
    );
  }
  lines.push("");

  lines.push("## 토큰", "");
  lines.push("| 카테고리 | 토큰 수 | 병합된 원값 |", "| --- | --- | --- |");
  for (const category of ["color", "spacing", "radius", "font-size"] as const) {
    const tokens = draft.tokens.filter((t) => t.category === category);
    lines.push(`| ${CATEGORY_LABEL[category]} | ${tokens.length} | ${tokens.reduce((n, t) => n + t.members.length, 0)} |`);
  }
  lines.push(`| 합계 | ${r.tokens.total} | ${r.tokens.mergedValues} |`, "");

  const colors = draft.tokens.filter((t) => t.category === "color");
  if (colors.length > 0) {
    lines.push("### 색 토큰", "");
    lines.push("결정 항목은 `decide --explain <결정 항목>`에 쓰는 키이고, CSS 변수는 코드에서 쓰는 이름입니다.", "");
    lines.push("| 결정 항목 | CSS 변수 | 값 | 사용 수 | members | 결정 |", "| --- | --- | --- | --- | --- | --- |");
    for (const t of colors) {
      const decision = t.chosen !== undefined ? `선택: ${t.chosen}` : t.members.length > 1 ? "pending" : "-";
      lines.push(`| ${t.key} | \`--${t.name}\` | ${t.value} | ${t.usageCount} | ${cell(t.members.join(", "))} | ${decision} |`);
    }
    lines.push("");
  }

  const inferred = draft.tokens.filter((t) => t.inferred === true);
  if (inferred.length > 0) {
    lines.push(
      `간격 토큰 중 ${inferred.map((t) => t.name).join(", ")}은(는) 4px 스케일에 걸리지 않는 값을 가장 가까운 스텝으로 모아 추론한 토큰입니다. ` +
        "추론 토큰의 members는 토큰 값(스텝)과 같지 않은 원값을 묶은 목록일 뿐 치환 대상 목록이 아닙니다 — " +
        "바꿀 수 있는 값은 아래 커버리지의 기준(토큰과 같거나 가까운 값)으로만 셉니다.",
      "",
    );
  }

  if (r.alphaDropped.length > 0) {
    lines.push("### 알파가 빠진 색", "");
    lines.push(
      "토큰 값은 6자리 hex라 투명도(알파)를 담지 못합니다. 아래 색은 알파를 뺀 hex로 토큰에 합쳐졌으니 migrate 전에 확인하세요.",
      "",
    );
    lines.push("| 원값 | 토큰 값 | 사용 수 |", "| --- | --- | --- |");
    for (const a of r.alphaDropped) lines.push(`| ${cell(a.raw)} | ${a.hex} | ${a.count} |`);
    lines.push("");
  }

  const c = r.coverage;
  lines.push("## 커버리지", "");
  const alphaCount = r.alphaDropped.reduce((n, a) => n + a.count, 0);
  lines.push(`전체: ${c.replaceable}/${c.total} (${pct(c.rate)})${alphaCount > 0 ? ` — 알파 ${alphaCount}건 포함` : ""}`, "");
  lines.push(
    `분모의 범위: 색·간격·모서리·글꼴 크기 속성의 하드코딩 값. 값을 정규화하지 못한 것(unknown) ${r.coverageScope.unknown}건과 토큰 대상이 아닌 길이(width·height) ${r.coverageScope.nonTokenProperties}건은 뺐습니다.`,
    "",
  );
  lines.push("| 카테고리 | 바꿀 수 있음 | 전체 |", "| --- | --- | --- |");
  for (const category of ["color", "spacing", "radius", "font-size"] as const) {
    const b = c.byCategory[category];
    lines.push(`| ${CATEGORY_LABEL[category]} | ${b.replaceable} | ${b.total} |`);
  }
  lines.push("");
  lines.push(
    `치환 가능(migrate 후보): 하드코딩 ${c.total}건 중 ${c.replaceable}건 — 같은 값/정확 ${c.byConfidence.exact}건은 migrate 기본 대상, 근사 ${c.byConfidence.close}건은 \`--close\`로만.`,
    "",
    "숫자의 구성: 색·글꼴 크기 토큰은 이 초안이 하드코딩 값에서 직접 만든 것이라 해당 카테고리 커버리지는 구성상 높게 나옵니다. " +
      "따라서 이 비율은 사실상 간격(4px 스케일에 걸리지 않는 값)과 모서리 커버리지를 반영합니다.",
  );
  if (c.zeroOrNegative > 0) {
    lines.push(`0 이하 간격(padding·margin·gap) ${c.zeroOrNegative}건은 토큰 대상이 아니라 분모에서 뺐습니다.`);
  }
  lines.push("");

  lines.push("## 스케일 밖 값", "");
  if (r.mappings.length === 0) {
    lines.push("없음", "");
  } else {
    lines.push(
      "토큰이 되지 못한 값과 가장 가까운 토큰입니다. 거리가 먼 토큰에 대응된 값은 위 커버리지의 '바꿀 수 있음'에 세지 않습니다.",
      "",
    );
    lines.push("| 카테고리 | 값 | 사용 수 | 가까운 토큰 | 거리 | 4px 스텝 |", "| --- | --- | --- | --- | --- | --- |");
    for (const m of r.mappings) {
      lines.push(
        `| ${CATEGORY_LABEL[m.category]} | ${m.px}px | ${m.count} | ${m.token ?? "-"} | ${m.distancePx === null ? "-" : `${m.distancePx}px`} | ${m.scaleName ?? "-"} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 스캐폴드", "");
  if (r.scaffolds.length === 0 && r.skippedScaffolds.length === 0) {
    lines.push("대상 없음 (--all 로 추천안 사용, 또는 /ds-decide 로 결정 후 다시 실행)", "");
  } else {
    for (const s of r.scaffolds) {
      const label =
        s.status === "created"
          ? "생성"
          : s.status === "updated"
            ? "갱신"
            : s.status === "unchanged" || s.status === "skipped-exists"
              ? "유지"
              : s.status;
      lines.push(`- ${label}: \`${s.file}\` — ${s.basis === "decided" ? "결정" : "추천"} ${s.from}`);
    }
    for (const s of r.skippedScaffolds) lines.push(`- 건너뜀: ${s.item} — ${s.reason}`);
    for (const w of r.warnings) lines.push(`- 경고: ${w}`);
    lines.push("");
  }

  if (r.tokensLoaded !== null && !r.tokensLoaded.css) {
    lines.push("## 토큰 스타일시트", "", `- ${TOKENS_NOT_LOADED_NOTE(r.outDir)}`, "");
  }

  if (r.tailwindPreset !== null) {
    const p = r.tailwindPreset;
    lines.push("## Tailwind 프리셋", "");
    lines.push(`- 파일: \`${p.file}\` (Tailwind v${p.version})`);
    lines.push(`- 연결: ${p.linked ? "연결됨" : "연결 안 됨"}`);
    if (!p.linked) {
      lines.push(
        p.version === 4
          ? `- 진입 CSS에서 \`@import "tailwindcss";\` 다음 줄에 \`@import "./${p.file}";\`를 추가하면 migrate가 클래스명(\`bg-ds-…\`)으로 치환합니다(경로는 CSS 파일 위치 기준으로 맞추세요).`
          : "- tailwind.config의 `presets`에 프리셋을 추가하면 migrate가 클래스명(`bg-ds-…`)으로 치환합니다.",
      );
    }
    lines.push(
      "- 클래스 키는 `ds-` 접두(`bg-ds-blue-400`, `p-ds-2`, `rounded-ds-sm`, `text-ds-xs`)로 Tailwind 기본 테마와 겹치지 않으며, 값은 `tokens.css` 변수 참조라 `tokens.css`가 전역에 로드돼 있어야 합니다.",
      "",
    );
  }

  lines.push("## 결정", "");
  lines.push(`pending ${r.decisions.pending}건 (\`/ds-decide\`로 고르기), stale ${r.decisions.stale}건`, "");
  return lines.join("\n");
}
