import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditWarnings, localDate } from "../src/report/audit-report.js";
import type { Index } from "@dsmith-dev/core";
import type { DetectResult } from "@dsmith-dev/detect";
import type { Extractor, StyleUsage } from "@dsmith-dev/extractor-api";
import { AI_TOOLS, loadCommands } from "@dsmith-dev/agent-skill";
import { TOOL_NAMES } from "@dsmith-dev/mcp-server";
import { computeAudit, runAudit } from "../src/commands/audit.js";
import { buildProgram } from "../src/program.js";
import { detectHints, runDetect } from "../src/commands/detect.js";
import { registry } from "../src/registry.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-cli-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function tailwindInlineRepo(): void {
  write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18", tailwindcss: "^3" } }));
  write(
    "src/A.tsx",
    `export const A = () => <div className="text-[#3B82F6] p-[13px]">a</div>;\n`,
  );
  write(
    "src/B.tsx",
    `export const B = () => <div style={{ color: "#3B82F6" }}>b</div>;\n`,
  );
}

describe("runDetect", () => {
  it("detect.json을 쓰고 provisional 결과를 돌려준다", async () => {
    tailwindInlineRepo();
    const result = await runDetect(tmp);
    expect(result.provisional).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".dsmith", "detect.json"))).toBe(true);
    expect(result.activeExtractors).toContain("tailwind");
    expect(result.extractorsResolved).toBe(true);
  });

  it("모노레포 루트면 --root apps/<app> 힌트를 낸다", async () => {
    write("package.json", JSON.stringify({ name: "mono", private: true }));
    write("pnpm-workspace.yaml", "packages:\n  - apps/*\n");
    write("apps/web/tailwind.config.ts", "export default {}");
    const result = await runDetect(tmp);
    expect(detectHints(result)).toEqual(["힌트: 모노레포 루트입니다. --root apps/<app> 로 실행하세요"]);
  });

  it("모노레포 루트가 아니면 힌트가 없다", async () => {
    tailwindInlineRepo();
    expect(detectHints(await runDetect(tmp))).toEqual([]);
  });
});

describe("runAudit", () => {
  it("임시 레포에서 detect·index·리포트를 만들고 정제된 detect.json을 남긴다", async () => {
    tailwindInlineRepo();
    const { result, reportPath } = await runAudit(tmp);

    expect(fs.existsSync(path.join(tmp, ".dsmith", "detect.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".dsmith", "index.json"))).toBe(true);
    const expectedReport = path.join(tmp, ".dsmith", "reports", `audit-${localDate(new Date())}.md`);
    expect(reportPath).toBe(expectedReport);
    expect(fs.existsSync(expectedReport)).toBe(true);

    expect(result.detect.activeExtractors).toEqual(expect.arrayContaining(["tailwind", "inline-style"]));
    expect(result.hardcoded.colors.length).toBeGreaterThanOrEqual(1);
    expect(result.hardcoded.colors[0]?.total).toBe(2);
    expect(result.hardcoded.spacing.some((s) => s.px === 13)).toBe(true);
    expect(result.hardcoded.byFile.map((f) => f.file).sort()).toEqual(["src/A.tsx", "src/B.tsx"]);

    const saved = JSON.parse(fs.readFileSync(path.join(tmp, ".dsmith", "detect.json"), "utf-8"));
    expect(saved.provisional).toBe(false);
    expect(saved.extractorsResolved).toBe(true);

    const md = fs.readFileSync(reportPath, "utf-8");
    expect(md).toContain("# DS Audit");
    expect(md).toContain("#3b82f6");
  });

  it("DS가 없으면 dsImportShare는 0이고 점수는 산식을 따른다", async () => {
    tailwindInlineRepo();
    const { result } = await runAudit(tmp);
    const { hardcodedShare, dsImportShare, duplicateCount, score } = result.health;
    expect(dsImportShare).toBe(0);
    expect(hardcodedShare).toBeGreaterThan(0);
    expect(score).toBe(
      Math.round(100 * (0.5 * (1 - hardcodedShare) + 0.3 * dsImportShare + 0.2 * Math.max(0, 1 - duplicateCount / 10))),
    );
  });

  it("같은 이름 컴포넌트가 다른 출처에서 오면 중복으로 보고한다", async () => {
    write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18" } }));
    write("src/a/Button.tsx", `export const Button = () => <button />;\n`);
    write("src/b/Button.tsx", `export const Button = () => <button />;\n`);
    write(
      "src/P.tsx",
      `import { Button } from "./a/Button";\nimport { Button as B2 } from "./b/Button";\nexport const P = () => <><Button /><Button /><B2 /></>;\n`,
    );
    write("src/Q.tsx", `import { Button } from "./b/Button";\nexport const Q = () => <Button />;\n`);
    const { result } = await runAudit(tmp);
    expect(result.components[0]).toEqual({ name: "Button", importedFrom: "src/a/Button", module: "src/a/Button", count: 2 });
    expect(result.duplicates).toEqual([{ names: ["Button"], reason: "same-name-different-source" }]);
    expect(result.health.duplicateCount).toBe(1);
  });

  function subpathAndLocalRepo(): void {
    write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18", "@mui/material": "^6" } }));
    write("src/A.tsx", `import Button from "@mui/material/Button";\nexport const A = () => <Button />;\n`);
    write("src/B.tsx", `import { Button } from "@mui/material";\nexport const B = () => <><Button /><Button /></>;\n`);
    write(
      "src/P.tsx",
      `import { Card } from "./Card";\nfunction Header() { return <header />; }\nfunction Footer() { return <footer />; }\nexport const P = () => <><Header /><Footer /><Card /></>;\n`,
    );
    write(
      "src/Q.tsx",
      `function Header() { return <header />; }\nfunction Card() { return <div />; }\nexport const Q = () => <><Header /><Header /><Card /></>;\n`,
    );
    write("src/Card.tsx", `export const Card = () => <div />;\n`);
  }

  it("패키지 서브패스와 루트 import는 같은 출처, import 없는 이름은 출처로 세지 않아 중복이 아니다", async () => {
    subpathAndLocalRepo();
    const { result } = await runAudit(tmp);
    expect(result.duplicates).toEqual([]);
    expect(result.health.duplicateCount).toBe(0);
    // 같은 module로 합쳐진 그룹은 처음 본(정렬된 파일 순서상 A.tsx의) importedFrom을 표시한다.
    expect(result.components.filter((c) => c.name === "Button")).toEqual([
      { name: "Button", importedFrom: "@mui/material/Button", module: "@mui/material", count: 3 },
    ]);
    // Card는 P.tsx에서 import, Q.tsx에서 지역 정의: 출처(module)는 하나뿐이라 중복이 아니다.
    expect(result.components.filter((c) => c.name === "Card").map((c) => c.module).sort()).toEqual(["", "src/Card"]);
  });

  it("두 파일에서 import 없이 쓰여도 어느 파일에도 최상위 선언이 없으면(props·지역 변수) 지역 재정의가 아니다", async () => {
    write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18" } }));
    write(
      "src/A.tsx",
      `export function A({ Icon, as }) { const Tag = as ?? "div"; return <Tag><Icon /></Tag>; }\nconst Header = () => <header />;\nexport const X = () => <Header />;\n`,
    );
    write(
      "src/B.tsx",
      `export function B({ Icon, as }) { const Tag = as ?? "span"; return <Tag><Icon /></Tag>; }\nfunction Header() { return <header />; }\nexport const Y = () => <Header />;\n`,
    );
    const { result } = await runAudit(tmp);
    expect(result.localDefinitions).toEqual([{ name: "Header", files: 2 }]);
  });

  it("두 파일 이상에서 import 없이 쓴 이름은 지역 재정의로 모은다(한 파일만이면 제외)", async () => {
    subpathAndLocalRepo();
    const { result, reportPath } = await runAudit(tmp);
    expect(result.localDefinitions).toEqual([
      { name: "Header", files: 2 },
    ]);
    expect(result.duplicates.flatMap((d) => d.names)).not.toContain("Header");
    const md = fs.readFileSync(reportPath, "utf-8");
    expect(md).toContain("## 지역 재정의 컴포넌트");
    expect(md).toContain("| Header | 2 |");
  });

  it("같은 이름이 패키지와 로컬 파일 두 module에서 오면 중복이다", async () => {
    subpathAndLocalRepo();
    write("src/ui/button.tsx", `export const Button = () => <button />;\n`);
    write("src/C.tsx", `import { Button } from "./ui/button";\nexport const C = () => <Button />;\n`);
    const { result } = await runAudit(tmp);
    expect(result.duplicates).toEqual([{ names: ["Button"], reason: "same-name-different-source" }]);
    expect(result.health.duplicateCount).toBe(1);
  });

  it("CSS Modules만 쓰는 레포: 평가한 스타일 값이 0이면 점수를 참고용으로 표기하고 분석하지 않은 방식을 알린다", async () => {
    // css-modules는 detect만 하고 Extractor가 없다. 교집합이 비어 inline-style 폴백만 켜진다.
    write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18" } }));
    write("src/A.module.css", ".box { color: #ef4444; padding: 13px; }\n");
    write("src/A.tsx", "import s from \"./A.module.css\";\nexport const A = () => <div className={s.box} />;\n");
    const { result, reportPath } = await runAudit(tmp);
    expect(result.detect.activeExtractors).toEqual(["inline-style"]);
    expect(result.index.files.scanned).toBe(1);
    expect(result.health.rated).toBe(0);
    const md = fs.readFileSync(reportPath, "utf-8");
    expect(md).toContain(`(스타일 데이터 없음 — 참고용) 건강 점수: ${result.health.score}`);
    expect(md).toContain("감지됐지만 분석하지 않은 방식: css-modules");
    expect(auditWarnings(result)).toEqual([
      `경고: (스타일 데이터 없음 — 참고용) 건강 점수: ${result.health.score}`,
      "경고: 감지됐지만 분석하지 않은 방식: css-modules",
    ]);
  });

  it("평가한 스타일 값이 있으면 참고용 표기·경고가 없다", async () => {
    tailwindInlineRepo();
    const { result, reportPath } = await runAudit(tmp);
    expect(result.health.rated).toBe(3);
    const md = fs.readFileSync(reportPath, "utf-8");
    expect(md).not.toContain("스타일 데이터 없음");
    expect(md).not.toContain("감지됐지만 분석하지 않은 방식");
    expect(auditWarnings(result)).toEqual([]);
  });

  it("빈 디렉터리에서도 예외 없이 점수 0과 분석할 파일 없음을 남긴다", async () => {
    const { result, reportPath } = await runAudit(tmp);
    expect(result.index.files.scanned).toBe(0);
    expect(result.health.score).toBe(0);
    expect(result.health.formula).toContain("hardcodedShare");
    expect(fs.readFileSync(reportPath, "utf-8")).toContain("분석할 파일 없음");
  });
});

describe("건강 점수", () => {
  it("레이아웃 값(display·position·opacity·fontWeight)과 var(--…) 참조만 있는 파일은 하드코딩으로 깎이지 않는다 (≥ 70)", async () => {
    write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18" } }));
    write(
      "src/Layout.tsx",
      `export const L = () => <div style={{ display: "flex", position: "relative", alignItems: "center", color: "var(--color-primary)", fontWeight: 700, opacity: 0.5 }} />;\n`,
    );
    const { result } = await runAudit(tmp);
    expect(result.health.hardcodedShare).toBe(0);
    expect(result.health.score).toBeGreaterThanOrEqual(70);
    expect(result.hardcoded.byFile).toEqual([]);
  });

  it("하드코딩 50%, DS 0%, 중복 0이면 45점이다 (100×(0.25+0+0.2))", async () => {
    write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18", tailwindcss: "^3" } }));
    write(
      "src/A.tsx",
      `export const A = () => <div className="text-[#3B82F6] text-gray-900">a</div>;\n`,
    );
    const { result } = await runAudit(tmp);
    expect(result.health).toMatchObject({ hardcodedShare: 0.5, dsImportShare: 0, duplicateCount: 0, score: 45 });
  });

  it("점수는 반올림 전 비율로 계산한다 (표시용 4자리 반올림이 점수 경계를 넘기지 않는다)", () => {
    // hardcodedShare = 1003/100000 = 0.01003 → 표시값 0.01, 점수 원값 69.4985 → 69
    // (반올림한 0.01로 계산하면 69.5 → 70)
    const usage = (source: "hardcoded" | "token"): StyleUsage => ({
      file: "src/A.tsx",
      line: 1,
      column: 0,
      property: "padding",
      raw: "4",
      normalized: { kind: "length", px: 4 },
      source,
      extractor: "inline-style",
    });
    const styles = [
      ...Array.from({ length: 1003 }, () => usage("hardcoded")),
      ...Array.from({ length: 98997 }, () => usage("token")),
    ];
    const index: Index = {
      root: "/x",
      createdAt: "",
      extractors: [],
      files: { scanned: 1, skipped: [] },
      styles,
      components: [],
    };
    const detectResult = { ds: { kind: "none", tokenFiles: [] } } as unknown as DetectResult;
    const { health } = computeAudit(detectResult, index);
    expect(health.hardcodedShare).toBe(0.01);
    expect(health.score).toBe(69);
  });
});

describe("플러그인 경계 (CLI)", () => {
  /** 서드파티 Extractor: `.txt`의 `#rrggbb`를 하드코딩 색으로 센다. core·detect·cli 소스는 이 이름을 모른다. */
  const txtExtractor: Extractor = {
    name: "txt",
    files: ["**/*.txt"],
    parses: "none",
    signals: { files: ["**/*.txt"] },
    appliesTo: () => true,
    extract: (ctx) =>
      [...ctx.code.matchAll(/#[0-9a-f]{6}/gi)].map((m) => ({
        file: ctx.file,
        line: 1,
        column: m.index ?? 0,
        property: "color" as const,
        raw: m[0],
        normalized: { kind: "unknown" as const },
        source: "hardcoded" as const,
        extractor: "txt",
      })),
    write: () => null,
  };

  afterEach(() => {
    delete registry.txt;
  });

  it("레지스트리에 한 줄 더한 Extractor가 signals로 감지·활성화되고 audit 인덱스까지 이어진다", async () => {
    write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18" } }));
    write("notes.txt", "brand #3b82f6\n");
    write("src/A.tsx", "export const A = () => <div />;\n");
    registry.txt = () => txtExtractor;

    const detected = await runDetect(tmp);
    expect(detected.styling.methods).toContainEqual({ name: "txt", evidence: ["notes.txt"], share: 0 });
    expect(detected.activeExtractors).toEqual(["txt"]);

    const { result } = await runAudit(tmp);
    expect(result.detect.activeExtractors).toEqual(["txt"]);
    const index = JSON.parse(fs.readFileSync(path.join(tmp, ".dsmith", "index.json"), "utf-8"));
    expect(index.extractors).toEqual(["txt"]);
    expect(index.styles).toEqual([expect.objectContaining({ file: "notes.txt", raw: "#3b82f6", extractor: "txt" })]);
    // .txt는 컴포넌트 파싱 대상이 아니라 skipped가 없다.
    expect(result.index.files.skipped).toEqual([]);
  });

  it("레지스트리에 없으면 signals가 맞아도 켜지지 않는다 (활성화 = detect 신호 ∧ 레지스트리 등록)", async () => {
    write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18" } }));
    write("notes.txt", "brand #3b82f6\n");
    const detected = await runDetect(tmp);
    expect(detected.activeExtractors).toEqual(["inline-style"]);
  });
});

describe("제외 (--exclude, overrides.exclude)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bin = path.resolve(here, "../dist/bin.js");

  function copyFixture(name: string): void {
    const src = path.resolve(here, "../../../fixtures", name);
    fs.cpSync(src, tmp, { recursive: true, filter: (p) => !p.split(path.sep).includes(".dsmith") });
  }

  function legacyRepo(): void {
    write("package.json", JSON.stringify({ name: "app", dependencies: { react: "^18" } }));
    write("src/A.tsx", `export const A = () => <div style={{ color: "#3B82F6", padding: 8 }} />;\n`);
    write("legacy/Old.tsx", `export const Old = () => <div style={{ color: "#EF4444", margin: 13 }} />;\n`);
  }

  it("압축·vendor 스타일시트를 fixture에 심어도 기본 제외라 점수·activeExtractors가 그대로다", async () => {
    copyFixture("mixed-app");
    const before = (await runAudit(tmp)).result;
    write("public/vendor/swiper.min.css", ".swiper{color:#123456;margin:7px;padding:3px}\n".repeat(50));
    write("vendor/big.min.css", "a{color:#abcdef;padding:11px}\n".repeat(50));
    const after = (await runAudit(tmp)).result;
    expect(after.detect.activeExtractors).toEqual(before.detect.activeExtractors);
    expect(after.health).toEqual(before.health);
    expect(after.index.files).toEqual(before.index.files);
  });

  it("runAudit의 exclude는 기본 제외에 더해져 감지·인덱스 모두에서 빠진다", async () => {
    legacyRepo();
    const all = (await runAudit(tmp)).result;
    expect(all.index.files.scanned).toBe(2);
    const { result } = await runAudit(tmp, { exclude: ["legacy/**"] });
    expect(result.index.files.scanned).toBe(1);
    expect(result.hardcoded.byFile.map((f) => f.file)).toEqual(["src/A.tsx"]);
    // 실행 옵션은 detect.json overrides로 저장하지 않는다.
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, ".dsmith", "detect.json"), "utf-8"));
    expect(saved.overrides).toBeUndefined();
  });

  it("detect.json의 overrides.exclude를 audit 인덱싱이 읽는다", async () => {
    legacyRepo();
    const first = await runDetect(tmp);
    fs.writeFileSync(
      path.join(tmp, ".dsmith", "detect.json"),
      JSON.stringify({ ...first, overrides: { exclude: ["legacy/**"] } }, null, 2),
    );
    const { result } = await runAudit(tmp);
    expect(result.index.files.scanned).toBe(1);
    expect(result.detect.overrides).toEqual({ exclude: ["legacy/**"] });
  });

  it("CLI --exclude는 여러 번·여러 값으로 줄 수 있다 (detect·audit)", () => {
    legacyRepo();
    write("old/B.tsx", `export const B = () => <div style={{ color: "#111111" }} />;\n`);
    const run = (...args: string[]) =>
      JSON.parse(execFileSync(process.execPath, [bin, ...args, "--root", tmp, "--json"], { encoding: "utf-8" }));
    expect(run("audit").index.files.scanned).toBe(3);
    expect(run("audit", "--exclude", "legacy/**", "old/**").index.files.scanned).toBe(1);
    expect(run("audit", "--exclude", "legacy/**", "--exclude", "old/**").index.files.scanned).toBe(1);
    const detected = run("detect", "--exclude", "legacy/**", "old/**", "src/**");
    expect(detected.styling.methods).toEqual([{ name: "inline-style", evidence: ["fallback"], share: 0 }]);
  });
});

describe("슬래시 명령 ↔ CLI·MCP 일관성", () => {
  it("명령 소스가 부르는 MCP 도구는 서버가 내는 도구 이름 안에 있다", async () => {
    const used = (await loadCommands()).flatMap((c) => c.uses.filter((u) => u.startsWith("mcp:")).map((u) => u.slice(4)));
    expect(used.length).toBeGreaterThan(0);
    for (const tool of used) expect(TOOL_NAMES as readonly string[]).toContain(tool);
  });

  it("명령 소스가 부르는 CLI 서브커맨드와 플래그는 실제로 등록돼 있다", async () => {
    const program = buildProgram();
    expect(program.commands.map((c) => c.name()).sort()).toEqual(["audit", "decide", "detect", "install", "mcp"]);
    const used = (await loadCommands()).flatMap((c) => c.uses.filter((u) => u.startsWith("cli:")).map((u) => u.slice(4)));
    expect(used.length).toBeGreaterThan(0);
    for (const use of used) {
      const [name, ...flags] = use.split(" ");
      const cmd = program.commands.find((c) => c.name() === name);
      expect(cmd, `서브커맨드 ${name}`).toBeDefined();
      for (const flag of flags) {
        expect(cmd?.options.map((o) => o.long), `${name}의 ${flag}`).toContain(flag);
      }
    }
  });

  it("install 옵션이 AI 도구 이름을 도움말에 보인다", () => {
    const help = buildProgram().commands.find((c) => c.name() === "install")?.helpInformation() ?? "";
    for (const tool of AI_TOOLS) expect(help).toContain(tool);
  });
});
