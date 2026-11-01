import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/commands/audit.js";

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
