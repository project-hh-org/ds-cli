import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localDate } from "../src/report/audit-report.js";
import { runAudit } from "../src/commands/audit.js";
import { runDetect } from "../src/commands/detect.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-cli-cli-"));
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
    expect(fs.existsSync(path.join(tmp, ".ds-cli", "detect.json"))).toBe(true);
    expect(result.activeExtractors).toContain("tailwind");
  });
});

describe("runAudit", () => {
  it("임시 레포에서 detect·index·리포트를 만들고 정제된 detect.json을 남긴다", async () => {
    tailwindInlineRepo();
    const { result, reportPath } = await runAudit(tmp);

    expect(fs.existsSync(path.join(tmp, ".ds-cli", "detect.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, ".ds-cli", "index.json"))).toBe(true);
    const expectedReport = path.join(tmp, ".ds-cli", "reports", `audit-${localDate(new Date())}.md`);
    expect(reportPath).toBe(expectedReport);
    expect(fs.existsSync(expectedReport)).toBe(true);

    expect(result.detect.activeExtractors).toEqual(expect.arrayContaining(["tailwind", "inline-style"]));
    expect(result.hardcoded.colors.length).toBeGreaterThanOrEqual(1);
    expect(result.hardcoded.colors[0]?.total).toBe(2);
    expect(result.hardcoded.spacing.some((s) => s.px === 13)).toBe(true);
    expect(result.hardcoded.byFile.map((f) => f.file).sort()).toEqual(["src/A.tsx", "src/B.tsx"]);

    const saved = JSON.parse(fs.readFileSync(path.join(tmp, ".ds-cli", "detect.json"), "utf-8"));
    expect(saved.provisional).toBe(false);

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
    expect(result.components[0]).toEqual({ name: "Button", importedFrom: "src/a/Button", count: 2 });
    expect(result.duplicates).toEqual([{ names: ["Button"], reason: "same-name-different-source" }]);
    expect(result.health.duplicateCount).toBe(1);
  });

  it("빈 디렉터리에서도 예외 없이 점수 0과 분석할 파일 없음을 남긴다", async () => {
    const { result, reportPath } = await runAudit(tmp);
    expect(result.index.files.scanned).toBe(0);
    expect(result.health.score).toBe(0);
    expect(result.health.formula).toContain("hardcodedShare");
    expect(fs.readFileSync(reportPath, "utf-8")).toContain("분석할 파일 없음");
  });
});
