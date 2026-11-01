import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readCatalog, readCssVariableTokens, readW3cTokens, type Catalog } from "@dsmith-dev/core";
import { readDetect, writeDetect } from "@dsmith-dev/detect";
import { runAiCommand } from "../src/commands/ai.js";
import { runAudit } from "../src/commands/audit.js";
import { runDecideChoose, runDecideExplain, runDecideList } from "../src/commands/decide.js";
import { runInitCommand } from "../src/commands/init.js";
import { runInstall } from "../src/commands/install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** `fixtures/<name>` 또는 `examples/<name>`(base 지정) 절대 경로. */
const fixture = (name: string, base: "fixtures" | "examples" = "fixtures"): string =>
  path.resolve(here, "../../..", base, name);

/** 실행 시각·체크아웃 위치에 따라 바뀌는 값(날짜, ISO 타임스탬프, 절대 경로)을 가린다. */
function mask(markdown: string, root: string): string {
  return markdown
    .split(root).join("<root>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, "<ts>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<date>");
}

function readJson(root: string, file: string): any {
  return JSON.parse(fs.readFileSync(path.join(root, ".dsmith", file), "utf-8"));
}

// runAudit은 fixture 안에 .dsmith/를 쓴다. 재현 가능하도록 실행 전후로 지운다.
let root = "";
function clean(): void {
  if (root !== "") fs.rmSync(path.join(root, ".dsmith"), { recursive: true, force: true });
}
beforeEach(() => {
  root = "";
});
afterEach(clean);

async function audit(name: string, base: "fixtures" | "examples" = "fixtures") {
  root = fixture(name, base);
  clean();
  const { result, reportPath } = await runAudit(root);
  return { result, report: mask(fs.readFileSync(reportPath, "utf-8"), root) };
}

describe("fixtures/tailwind-app", () => {
  it("Tailwind만 켜지고, 근접한 파랑 두 개가 한 클러스터로 합쳐진다", async () => {
    const { result, report } = await audit("tailwind-app");
    expect(result.detect.state).toBe(0);
    expect(result.detect.ds.kind).toBe("none");
    expect(result.detect.activeExtractors).toEqual(["tailwind"]);

    expect(result.hardcoded.colors).toHaveLength(2);
    const blue = result.hardcoded.colors.find((c) => c.members.length === 2);
    expect(blue?.members.map((m) => m.hex).sort()).toEqual(["#3b82f6", "#3c83f7"]);
    expect(blue?.total).toBe(2);
    expect(result.hardcoded.colors.flatMap((c) => c.members.map((m) => m.hex))).toContain("#ef4444");

    expect(result.hardcoded.spacing).toContainEqual(expect.objectContaining({ px: 13, onScale: false }));
    expect(result.dynamicCount).toBe(0);
    expect(report).toMatchSnapshot();
  });
});

describe("fixtures/inline-app", () => {
  it("inline-style만 켜지고 동적 값 1건을 센다. background 축약형 색도 색 클러스터에 들어간다", async () => {
    const { result, report } = await audit("inline-app");
    expect(result.detect.state).toBe(0);
    expect(result.detect.activeExtractors).toEqual(["inline-style"]);
    expect(result.dynamicCount).toBe(1);
    expect(result.hardcoded.colors.flatMap((c) => c.members.map((m) => m.hex))).toContain("#ef4444");
    expect(result.hardcoded.spacing).toContainEqual(expect.objectContaining({ px: 12 }));
    expect(report).toMatchSnapshot();
  });
});

describe("fixtures/mixed-app", () => {
  it("두 extractor가 켜지고, 한 파일에서 양쪽 usage가 모두 인덱스에 남는다", async () => {
    const { result, report } = await audit("mixed-app");
    expect(result.detect.activeExtractors).toEqual(expect.arrayContaining(["tailwind", "inline-style"]));
    expect(result.detect.activeExtractors).toHaveLength(2);

    const index = readJson(root, "index.json");
    const banner = index.styles.filter((u: { file: string }) => u.file === "src/Banner.tsx");
    expect(new Set(banner.map((u: { extractor: string }) => u.extractor))).toEqual(
      new Set(["tailwind", "inline-style"]),
    );
    expect(result.hardcoded.byFile.find((f) => f.file === "src/Banner.tsx")?.count).toBe(2);
    expect(report).toMatchSnapshot();
  });
});

describe("fixtures/with-ds-app", () => {
  it("radix + 로컬 components/ui는 로컬 DS이고, Button 중복과 DS import 비율을 보고한다", async () => {
    const { result, report } = await audit("with-ds-app");
    expect(result.detect.ds.kind).toBe("local");
    expect(result.detect.ds.dir).toBe("components/ui");
    expect(result.detect.state).toBe(1);

    expect(result.duplicates).toEqual([{ names: ["Button"], reason: "same-name-different-source" }]);
    expect(result.components.filter((c) => c.name === "Button").map((c) => c.importedFrom).sort()).toEqual([
      "components/ui/Button",
      "src/legacy/Button",
    ]);
    // Settings.tsx의 `@/legacy/Button` 별칭 import는 Admin.tsx의 상대 경로 import와 같은 출처로 합쳐진다.
    expect(result.components.find((c) => c.importedFrom === "src/legacy/Button")?.count).toBe(2);
    expect(result.health.dsImportShare).toBeGreaterThan(0);
    expect(result.health.duplicateCount).toBe(1);
    expect(report).toMatchSnapshot();
  });
});

describe("fixtures/styled-app", () => {
  it("styled만 켜지고, 템플릿 리터럴의 근접한 파랑이 한 클러스터로 합쳐지며 지역 Header는 중복이 아니다", async () => {
    const { result, report } = await audit("styled-app");
    expect(result.detect.state).toBe(0);
    expect(result.detect.ds.kind).toBe("none");
    expect(result.detect.activeExtractors).toEqual(["styled"]);

    expect(result.hardcoded.colors).toHaveLength(1);
    expect(result.hardcoded.colors[0]?.members.map((m) => m.hex).sort()).toEqual(["#3b82f6", "#3c83f7"]);
    expect(result.dynamicCount).toBe(1);
    expect(result.hardcoded.spacing).toContainEqual(expect.objectContaining({ px: 13, onScale: false }));

    expect(result.localDefinitions).toEqual([{ name: "Header", files: 2 }]);
    expect(result.duplicates).toEqual([]);
    expect(report).toMatchSnapshot();
  });
});

describe("fixtures/emotion-app", () => {
  it("emotion이 켜지고, css prop 객체의 중첩 &:hover 색까지 하드코딩 색 2종으로 센다", async () => {
    const { result, report } = await audit("emotion-app");
    expect(result.detect.activeExtractors).toEqual(["emotion"]);

    expect(result.hardcoded.colors).toHaveLength(2);
    expect(result.hardcoded.colors.flatMap((c) => c.members.map((m) => m.hex)).sort()).toEqual(["#111827", "#ef4444"]);
    // #EF4444는 Orders.tsx의 `"&:hover": { color }` 안에만 있다.
    const index = readJson(root, "index.json");
    const hover = index.styles.filter(
      (u: { file: string; normalized: { hex?: string } }) => u.file === "src/pages/Orders.tsx" && u.normalized.hex === "#ef4444",
    );
    expect(hover).toHaveLength(1);
    expect(hover[0]).toMatchObject({ extractor: "emotion", source: "hardcoded", property: "color" });
    // Panel.tsx의 `css={panel}` 참조는 dynamic other 한 건이다(점수 대상 아님, 점수 불변).
    expect(result.dynamicCount).toBe(1);
    expect(index.styles).toContainEqual(
      expect.objectContaining({ file: "src/components/Panel.tsx", raw: "panel", property: "other", source: "dynamic" }),
    );
    expect(result.health.score).toBe(20);
    expect(report).toMatchSnapshot();
  });
});

describe("fixtures/mui-app", () => {
  it("mui-sx가 켜지고, @mui/material이 대표 DS이며 서브패스 Button import는 중복이 아니다", async () => {
    const { result, report } = await audit("mui-app");
    expect(result.detect.activeExtractors).toContain("mui-sx");
    expect(result.detect.ds.kind).toBe("npm");
    expect(result.detect.ds.packageName).toBe("@mui/material");
    expect(result.duplicates).toEqual([]);

    const index = readJson(root, "index.json");
    // 서브패스 병합: 루트 import와 서브패스 import의 Button이 같은 module로 정규화된다.
    const buttons = index.components.filter((c: { name: string }) => c.name === "Button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect(new Set(buttons.map((c: { importedFrom: string }) => c.importedFrom))).toEqual(
      new Set(["@mui/material", "@mui/material/Button"]),
    );
    expect(new Set(buttons.map((c: { module: string }) => c.module))).toEqual(new Set(["@mui/material"]));

    const tokens = index.styles.filter((u: { source: string }) => u.source === "token");
    expect(tokens.length).toBe(4);
    // paddingTop(장문 spacing 키)도 token으로 센다.
    expect(tokens).toContainEqual(expect.objectContaining({ file: "src/pages/Plans.tsx", property: "padding", extractor: "mui-sx" }));
    expect(result.hardcoded.colors.flatMap((c) => c.members.map((m) => m.hex))).toContain("#111111");
    expect(report).toMatchSnapshot();
  });
});

describe("examples/legacy-demo", () => {
  it("Tailwind·inline·CSS가 섞인 데모 어드민: 점수 52, Button·Badge 중복, 세 Extractor가 켜진다", async () => {
    const { result, report } = await audit("legacy-demo", "examples");
    expect(result.detect.activeExtractors).toEqual(["tailwind", "inline-style", "css"]);
    expect(result.detect.ds).toMatchObject({ kind: "local", dir: "src/components/ui" });
    expect(result.detect.state).toBe(1);
    expect(result.duplicates).toEqual([{ names: ["Button", "Badge"], reason: "same-name-different-source" }]);
    expect(result.index.files).toEqual({ scanned: 26, skipped: [] });
    // css 추출기가 app/globals.css의 하드코딩 값 7건을 평가에 더해 53 → 52가 됐다.
    expect(result.hardcoded.byFile).toContainEqual({ file: "app/globals.css", count: 7 });
    expect(result.health).toMatchObject({ score: 52, rated: 187, hardcodedShare: 0.3422, dsImportShare: 0.0909, duplicateCount: 2 });
    expect(report).toMatchSnapshot();
  });
});

describe("examples/legacy-demo: audit → install → decide", () => {
  it("audit 뒤 claude-code만 설치하고, 같은 레포에서 결정 카드가 ui/button을 추천한다", async () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-e2e-install-")));
    const repo = path.join(tmp, "legacy-demo");
    const home = path.join(tmp, "home");
    fs.mkdirSync(home);
    try {
      fs.cpSync(fixture("legacy-demo", "examples"), repo, {
        recursive: true,
        filter: (src) => !src.split(path.sep).includes(".dsmith"),
      });
      await runAudit(repo);
      const result = await runInstall({ root: repo, home, tools: ["claude-code"], version: "0.2.0" });
      expect(result.outcomes.map((o) => o.status)).toEqual(Array(10).fill("created"));

      const list = (dir: string, prefix = ""): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? list(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
        );
      const installed = list(repo).filter((f) => f.startsWith(".claude/") || f === ".mcp.json" || f === ".dsmith/install.json");
      expect(installed.sort()).toEqual([
        ".claude/skills/ds-ai/SKILL.md",
        ".claude/skills/ds-audit/SKILL.md",
        ".claude/skills/ds-check/SKILL.md",
        ".claude/skills/ds-decide/SKILL.md",
        ".claude/skills/ds-detect/SKILL.md",
        ".claude/skills/ds-guard/SKILL.md",
        ".claude/skills/ds-init/SKILL.md",
        ".claude/skills/ds-migrate/SKILL.md",
        ".claude/skills/ds/SKILL.md",
        ".dsmith/install.json",
        ".mcp.json",
      ]);
      expect(JSON.parse(fs.readFileSync(path.join(repo, ".mcp.json"), "utf-8"))).toEqual({
        mcpServers: { dsmith: { command: "npx", args: ["-y", "dsmith@0.2", "mcp"] } },
      });
      // 홈에는 아무것도 쓰지 않았다
      expect(fs.readdirSync(home)).toEqual([]);

      const card = await runDecideExplain(repo, "Button", { git: false });
      if (!("card" in card)) throw new Error("not-found");
      expect(card.card.recommendation.optionId).toBe("src/components/ui/button");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── DS 초안 (init · ai) — 모두 임시 복사본에서 돌린다. 원본 fixture에는 .dsmith/를 만들지 않는다 ──

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** fixtures|examples/<name> → 임시 복사본(.dsmith 제외). overlay = 상대 경로 → 파일 내용 */
function tmpCopy(name: string, base: "fixtures" | "examples", overlay: Record<string, string> = {}): string {
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-e2e-draft-")));
  tmpRoots.push(dest);
  fs.cpSync(fixture(name, base), dest, { recursive: true, filter: (src) => !src.split(path.sep).includes(".dsmith") });
  for (const [file, content] of Object.entries(overlay)) {
    fs.mkdirSync(path.dirname(path.join(dest, file)), { recursive: true });
    fs.writeFileSync(path.join(dest, file), content);
  }
  return dest;
}

/** 경로+내용 해시. .dsmith/reports는 날짜가 파일명에 들어가므로 뺀다 */
function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string, prefix: string): void => {
    for (const e of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = `${prefix}${e.name}`;
      if (rel === ".dsmith/reports") continue;
      if (e.isDirectory()) walk(path.join(current, e.name), `${rel}/`);
      else hash.update(rel).update("\0").update(fs.readFileSync(path.join(current, e.name))).update("\0");
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}

/** 상태 0 강제: audit → detect.json에 ds none·state 0 overrides → 다시 audit */
async function auditAsStateZero(root: string): ReturnType<typeof runAudit> {
  await runAudit(root);
  const current = await readDetect(root);
  if (current === null) throw new Error("audit이 detect.json을 남기지 않음");
  await writeDetect(root, { ...current, overrides: { ds: { kind: "none", tokenFiles: [] }, state: 0 } });
  return runAudit(root);
}

const findComponent = (catalog: Catalog | null, name: string) => catalog?.components.find((c) => c.name === name);

describe("examples/legacy-demo 상태 0: audit → init --all → ai → init", () => {
  it("토큰 3종·스캐폴드·커버리지가 리포트와 맞고, ai는 design-system/ 기준 카탈로그를 만들고, 두 번째 init은 diff가 없다", async () => {
    const root = tmpCopy("legacy-demo", "examples");
    const { result: audited } = await auditAsStateZero(root);
    expect(audited.detect.state).toBe(0);
    expect(audited.detect.ds.kind).toBe("none");

    const { result: init } = await runInitCommand({ root, all: true });

    // tokens.json 색 토큰 수 = audit 리포트의 색 클러스터 수
    const json = fs.readFileSync(path.join(root, "design-system", "tokens.json"), "utf-8");
    const fromJson = readW3cTokens(json, "design-system/tokens.json");
    expect(fromJson.warnings).toEqual([]);
    expect(fromJson.tokens.filter((t) => t.category === "color")).toHaveLength(audited.hardcoded.colors.length);
    expect(init.tokens.color).toBe(audited.hardcoded.colors.length);

    // tokens.css는 유효한 CSS 변수 목록이고 세 파일의 토큰 수가 같다
    const css = fs.readFileSync(path.join(root, "design-system", "tokens.css"), "utf-8");
    expect(readCssVariableTokens(css, "design-system/tokens.css")).toHaveLength(init.tokens.total);
    expect(fromJson.tokens).toHaveLength(init.tokens.total);
    expect(fs.existsSync(path.join(root, "design-system", "tokens.ts"))).toBe(true);

    // 스캐폴드 N = min(10, 중복 이름 + 지역 재정의)
    const candidates = new Set([...audited.duplicates.flatMap((d) => d.names), ...audited.localDefinitions.map((l) => l.name)]);
    expect(init.scaffolds.filter((x) => x.status === "created")).toHaveLength(Math.min(10, candidates.size));
    for (const sc of init.scaffolds) expect(fs.existsSync(path.join(root, sc.file)), sc.file).toBe(true);

    // 리포트의 커버리지 줄 = InitResult.coverage
    const report = fs.readFileSync(path.join(root, init.report ?? ""), "utf-8");
    const line = /전체: (\d+)\/(\d+)/.exec(report);
    expect(line?.slice(1, 3).map(Number)).toEqual([init.coverage.replaceable, init.coverage.total]);
    expect(init.coverage.total).toBeGreaterThan(0);

    // ai: 카탈로그가 init 산출(design-system/) 기준
    const ai = await runAiCommand({ root });
    expect(ai.sources[0]?.origin).toBe("init");
    const catalog = await readCatalog(root);
    expect(catalog?.components.map((c) => c.name).sort()).toEqual(init.scaffolds.map((x) => x.name).sort());
    expect(catalog?.components.every((c) => c.origin === "init" && c.file?.startsWith("design-system/"))).toBe(true);
    expect(catalog?.tokens).toHaveLength(init.tokens.total);

    // 두 번째 init: 아무것도 바뀌지 않는다
    const before = treeHash(root);
    const { result: again } = await runInitCommand({ root, all: true });
    expect(again.outcomes.map((o) => o.status).every((st) => st === "unchanged" || st === "skipped-exists")).toBe(true);
    expect(treeHash(root)).toBe(before);
  });
});

describe("examples/legacy-demo 상태 1: init → decide → init → ai", () => {
  it("--all 없이 스캐폴드 0·pending ≥ 2, Badge를 고르면 Badge.tsx가 생기고 카탈로그에 로컬 DS Button과 init Badge가 함께 있다", async () => {
    const root = tmpCopy("legacy-demo", "examples");
    const { result: audited } = await runAudit(root);
    expect(audited.detect.state).toBe(1);

    const first = (await runInitCommand({ root })).result;
    expect(first.scaffolds).toEqual([]);
    expect(first.decisions.pending).toBeGreaterThanOrEqual(2);

    const items = await runDecideList(root);
    const badge = items.find((i) => i.item === "Badge" && i.kind === "duplicate");
    expect(badge).toBeDefined();
    const local = badge?.options.find((o) => !o.includes("ui/")) ?? badge?.options[0];
    await runDecideChoose(root, "Badge", local as string, undefined, { kind: "duplicate" });

    const second = (await runInitCommand({ root })).result;
    expect(second.scaffolds.map((x) => [x.name, x.status])).toEqual([["Badge", "created"]]);
    expect(fs.existsSync(path.join(root, "design-system", "components", "Badge.tsx"))).toBe(true);

    await runAiCommand({ root });
    const catalog = await readCatalog(root);
    const button = findComponent(catalog, "Button");
    expect(button).toMatchObject({ module: "src/components/ui/button", origin: "ds-local" });
    expect(button?.props.find((p) => p.name === "variant")?.values).toHaveLength(4);
    expect(findComponent(catalog, "Badge")?.origin).toBe("init");
  });
});

describe("fixtures/mui-app + npm 타입(node_modules)", () => {
  it("ai가 @mui/material의 Button props variant·size·color를 values와 함께 카탈로그에 넣는다", async () => {
    const root = tmpCopy("mui-app", "fixtures");
    fs.cpSync(fixture("npm-types/mui-material-6"), path.join(root, "node_modules", "@mui", "material"), { recursive: true });
    await runAudit(root);

    const ai = await runAiCommand({ root });
    expect(ai.sources[0]).toMatchObject({ origin: "ds-npm", packageName: "@mui/material" });
    const button = findComponent(await readCatalog(root), "Button");
    expect(button?.origin).toBe("ds-npm");
    const values = (name: string): string[] => button?.props.find((p) => p.name === name)?.values ?? [];
    expect(values("variant")).toEqual(expect.arrayContaining(["text", "outlined", "contained"]));
    expect(values("size")).toEqual(expect.arrayContaining(["small", "medium", "large"]));
    expect(values("color")).toEqual(expect.arrayContaining(["primary", "secondary", "error"]));
  });
});

describe("fixtures/mixed-app 자연 상태 0 (overrides 없음): audit → init → audit → ai", () => {
  it("DS 없음으로 감지되고, init 뒤 다시 audit해도 ai의 AGENTS.md 토큰 파일 줄에 같은 파일이 두 번 나오지 않는다", async () => {
    const root = tmpCopy("mixed-app", "fixtures");
    const { result: audited } = await runAudit(root);
    expect(audited.detect.state).toBe(0);
    expect(audited.detect.ds.kind).toBe("none");
    expect(audited.detect.overrides).toBeUndefined();

    const { result: init, text } = await runInitCommand({ root });
    expect(init.tokens.total).toBeGreaterThan(0);
    expect(init.catalog).toBe("needs-ai");
    expect(text).toContain("다음: dsmith ai");
    // 결정할 것이 없으면 pending 힌트를 붙이지 않는다
    expect(init.decisions.pending).toBe(0);
    expect(text).toContain("결정: pending 0건\n");
    expect(text).not.toContain("/ds-decide");

    // init이 만든 토큰 파일이 이제 DS로 감지된다
    const { result: again } = await runAudit(root);
    expect(again.detect.ds.tokenFiles).toContain("design-system/tokens.css");

    await runAiCommand({ root });
    const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8");
    const tokenLine = agents.split("\n").find((l) => l.startsWith("- 토큰 파일")) ?? "";
    expect(tokenLine).toContain("`design-system/tokens.css`");
    expect(tokenLine.match(/design-system\/tokens\.css/g)).toHaveLength(1);
    const catalog = await readCatalog(root);
    expect(catalog?.tokens).toHaveLength(init.tokens.total);

    // 이제 카탈로그가 있으니 init은 안내 대신 카탈로그와 맞는지 확인한다
    expect((await runInitCommand({ root })).result.catalog).toBe("current");
  });
});
