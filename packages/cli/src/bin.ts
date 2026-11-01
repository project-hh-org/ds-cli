#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runAudit } from "./commands/audit.js";
import {
  explainJson,
  formatDecideExplain,
  formatDecideList,
  runDecideChoose,
  runDecideExplain,
  runDecideList,
} from "./commands/decide.js";
import { detectHints, formatDetectSummary, runDetect } from "./commands/detect.js";
import { auditWarnings } from "./report/audit-report.js";

interface CommonOptions {
  root: string;
  json?: boolean;
  exclude?: string[];
}

const program = new Command();
program.name("dsmith").description("디자인시스템 라이프사이클 CLI").exitOverride();

function common(cmd: Command): Command {
  return cmd
    .option("--root <dir>", "대상 레포 경로", process.cwd())
    .option("--json", "결과를 JSON으로만 stdout에 출력")
    .option(
      "--exclude <glob...>",
      "기본 제외(node_modules·dist·*.min.css·vendor 등)에 더할 glob. 여러 번 줄 수 있다",
    );
}

common(program.command("detect").description("레포 환경을 감지하고 .dsmith/detect.json에 저장")).action(
  async (opts: CommonOptions) => {
    const result = await runDetect(opts.root, { exclude: opts.exclude ?? [] });
    for (const hint of detectHints(result)) process.stderr.write(`${hint}\n`);
    process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatDetectSummary(result)}\n`);
  },
);

common(program.command("audit").description("하드코딩·컴포넌트 사용을 분석해 .dsmith/reports에 리포트 저장")).action(
  async (opts: CommonOptions) => {
    const { result, reportPath } = await runAudit(opts.root, { exclude: opts.exclude ?? [] });
    for (const line of [...detectHints(result.detect), ...auditWarnings(result)]) process.stderr.write(`${line}\n`);
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

interface DecideOptions {
  root: string;
  json?: boolean;
  list?: boolean;
  status?: string;
  limit?: string;
  explain?: string;
  kind?: string;
  item?: string;
  choose?: string;
  note?: string;
  git: boolean;
}

const DECIDE_KINDS = ["duplicate", "local-definition"] as const;
type DecideKind = (typeof DECIDE_KINDS)[number];

program
  .command("decide")
  .description("중복·지역 재정의 컴포넌트의 결정 카드를 보고 선택을 .dsmith/decisions.json에 기록")
  .option("--root <dir>", "대상 레포 경로", process.cwd())
  .option("--json", "결과를 JSON으로만 stdout에 출력")
  .option("--list", "결정할 항목 목록")
  .option("--status <status>", "--list 필터: pending | decided")
  .option("--limit <n>", "--list에 보일 최대 항목 수(기본: 전부)")
  .option("--explain <item>", "항목의 결정 카드(옵션·차이·영향·추천)")
  .option("--no-git", "--explain에서 git 이력을 읽지 않는다")
  .option("--kind <kind>", "같은 이름이 duplicate와 local-definition 둘 다일 때 종류 지정")
  .option("--item <name>", "--choose로 결정할 항목")
  .option("--choose <id>", "--item의 선택지 id를 결정으로 기록")
  .option("--note <text>", "--choose에 남길 메모")
  .action(async (opts: DecideOptions) => {
    const modes = [opts.list === true, opts.explain !== undefined, opts.choose !== undefined].filter(Boolean).length;
    if (modes !== 1) throw new Error("--list, --explain <item>, --item <name> --choose <id> 중 정확히 하나를 지정하세요");
    if (opts.status !== undefined && opts.status !== "pending" && opts.status !== "decided") {
      throw new Error(`--status는 pending 또는 decided여야 합니다: ${opts.status}`);
    }
    if (opts.status !== undefined && opts.list !== true) throw new Error("--status는 --list와 함께 씁니다");
    if (opts.limit !== undefined && opts.list !== true) throw new Error("--limit는 --list와 함께 씁니다");
    const limit = opts.limit === undefined ? undefined : Number(opts.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new Error(`--limit는 1 이상의 정수여야 합니다: ${opts.limit}`);
    }
    const kind = opts.kind as DecideKind | undefined;
    if (kind !== undefined && !DECIDE_KINDS.includes(kind)) {
      throw new Error(`--kind는 ${DECIDE_KINDS.join(" | ")} 중 하나여야 합니다: ${opts.kind}`);
    }
    if (kind !== undefined && opts.list === true) throw new Error("--kind는 --explain·--choose와 함께 씁니다");
    // 사람용 문자열은 --json이 아닐 때만 만든다.
    const out = (json: unknown, human: () => string): void => {
      process.stdout.write(opts.json ? `${JSON.stringify(json, null, 2)}\n` : `${human()}\n`);
    };

    if (opts.list === true) {
      const items = await runDecideList(opts.root, opts.status as "pending" | "decided" | undefined);
      out(limit === undefined ? items : items.slice(0, limit), () => formatDecideList(items, limit));
    } else if (opts.explain !== undefined) {
      const result = await runDecideExplain(opts.root, opts.explain, { git: opts.git, ...(kind ? { kind } : {}) });
      out(explainJson(result), () => formatDecideExplain(result));
      if ("error" in result) process.exitCode = 1;
    } else if (opts.choose !== undefined) {
      if (opts.item === undefined) throw new Error("--choose에는 --item <name>이 필요합니다");
      const record = await runDecideChoose(opts.root, opts.item, opts.choose, opts.note, kind ? { kind } : {});
      out(record, () => `결정 기록: ${record.item} → ${opts.choose} (.dsmith/decisions.json)`);
    }
  });

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
