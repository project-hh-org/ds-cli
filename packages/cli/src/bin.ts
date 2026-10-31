#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runAudit } from "./commands/audit.js";
import { formatDetectSummary, runDetect } from "./commands/detect.js";
import { auditWarnings } from "./report/audit-report.js";

interface CommonOptions {
  root: string;
  json?: boolean;
}

const program = new Command();
program.name("ds-cli").description("디자인시스템 라이프사이클 CLI").exitOverride();

function common(cmd: Command): Command {
  return cmd
    .option("--root <dir>", "대상 레포 경로", process.cwd())
    .option("--json", "결과를 JSON으로만 stdout에 출력");
}

common(program.command("detect").description("레포 환경을 감지하고 .ds-cli/detect.json에 저장")).action(
  async (opts: CommonOptions) => {
    const result = await runDetect(opts.root);
    process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatDetectSummary(result)}\n`);
  },
);

common(program.command("audit").description("하드코딩·컴포넌트 사용을 분석해 .ds-cli/reports에 리포트 저장")).action(
  async (opts: CommonOptions) => {
    const { result, reportPath } = await runAudit(opts.root);
    for (const warning of auditWarnings(result)) process.stderr.write(`${warning}\n`);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const { health } = result;
    process.stdout.write(
      `건강 점수: ${health.score}\n리포트: ${path.relative(process.cwd(), reportPath) || reportPath}\n`,
    );
  },
);

try {
  await program.parseAsync(process.argv);
} catch (err) {
  // commander의 --help/--version 종료는 exitOverride로 CommanderError(exitCode 0)가 된다.
  const exitCode = (err as { exitCode?: number }).exitCode;
  if (typeof exitCode === "number") process.exitCode = exitCode;
  else {
    process.stderr.write(`오류: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
