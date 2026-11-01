import path from "node:path";
import { Command } from "commander";
import { AI_TOOLS, type AiTool } from "@dsmith-dev/agent-skill";
import { AI_FROM, formatAiSummary, runAiCommand } from "./commands/ai.js";
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
import { runInitCommand } from "./commands/init.js";
import { formatInstallSummary, runInstall } from "./commands/install.js";
import { runMcp } from "./commands/mcp.js";
import { auditWarnings } from "./report/audit-report.js";

interface CommonOptions {
  root: string;
  json?: boolean;
  exclude?: string[];
}

function common(cmd: Command): Command {
  return cmd
    .option("--root <dir>", "대상 레포 경로", process.cwd())
    .option("--json", "결과를 JSON으로만 stdout에 출력")
    .option(
      "--exclude <glob...>",
      "기본 제외(node_modules·dist·*.min.css·vendor 등)에 더할 glob. 여러 번 줄 수 있다",
    );
}

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

const DECIDE_KINDS = ["duplicate", "local-definition", "token-cluster"] as const;
type DecideKind = (typeof DECIDE_KINDS)[number];

interface AiCliOptions {
  root: string;
  json?: boolean;
  from: string;
  dryRun?: boolean;
  force?: boolean;
}

interface McpOptions {
  root?: string;
  budget?: string;
  git: boolean;
}

interface InstallCliOptions {
  root: string;
  json?: boolean;
  tool?: string[];
  all?: boolean;
  global?: boolean;
  dryRun?: boolean;
  force?: boolean;
  mcpCommand?: string;
}

interface InitCliOptions {
  root: string;
  json?: boolean;
  out?: string;
  all?: boolean;
  top?: string;
  dryRun?: boolean;
  force?: boolean;
}

/** `dsmith` 커맨드 트리. 실행(parse)은 bin.ts가 하고, 테스트는 이 트리를 직접 들여다본다. */
export function buildProgram(): Command {
  const program = new Command();
  program.name("dsmith").description("디자인시스템 라이프사이클 CLI").exitOverride();

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
      const shownPath = path.relative(process.cwd(), reportPath) || reportPath;
      if (opts.json) {
        // JSON 모양은 그대로 두고, 리포트 경로는 stderr로 알린다(슬래시 명령이 여기서 읽는다).
        process.stderr.write(`리포트: ${shownPath}\n`);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      const { health } = result;
      process.stdout.write(`건강 점수: ${health.score}\n리포트: ${shownPath}\n`);
    },
  );

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
    .option("--kind <kind>", "종류 지정(duplicate | local-definition | token-cluster). 같은 이름이 둘 이상일 때 필요")
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

  program
    .command("mcp")
    .description("MCP 서버를 stdio로 실행(AI 도구가 띄운다). stdout은 JSON-RPC 전용, 로그는 stderr. 인덱스가 없으면 audit을 1회 실행")
    .option("--root <dir>", "대상 레포 경로(기본: cwd에서 위로 .dsmith/ 또는 .git이 있는 가장 가까운 디렉터리)")
    .option("--budget <tokens>", "도구 응답 하나의 추정 토큰 상한(기본 1500)")
    .option("--no-git", "explain_decision에서 git 이력을 읽지 않는다")
    .action(async (opts: McpOptions) => {
      const budget = opts.budget === undefined ? undefined : Number(opts.budget);
      if (budget !== undefined && (!Number.isInteger(budget) || budget < 1)) {
        throw new Error(`--budget은 1 이상의 정수여야 합니다: ${opts.budget}`);
      }
      await runMcp({ root: opts.root, budget, git: opts.git });
    });

  program
    .command("install")
    .description(
      "사용 중인 AI 도구를 감지해 슬래시 명령과 MCP 서버 등록을 레포에 내려쓴다. 사용자가 고친 파일은 --force 없이 덮어쓰지 않음",
    )
    .option("--root <dir>", "대상 레포 경로", process.cwd())
    .option("--json", "결과를 JSON으로만 stdout에 출력")
    .option(
      "--tool <name...>",
      `감지 대신 지정할 AI 도구(${AI_TOOLS.join(" | ")}). 여러 번·여러 값으로 줄 수 있다`,
    )
    .option("--all", "AI 도구 전부 설치")
    .option("--global", "레포 대신 사용자 홈에 설치(claude-code·codex만 지원). 홈의 흔적만으로 도구를 고른다")
    .option("--dry-run", "아무것도 쓰지 않고 쓸 파일과 diff만 출력")
    .option("--force", "사용자가 고친 영역도 덮어쓴다")
    .option(
      "--mcp-command <cmd>",
      '배포 전 로컬 개발용 MCP 실행 명령(예: "node /abs/packages/cli/dist/bin.js"). 끝의 mcp는 자동으로 붙는다',
    )
    .action(async (opts: InstallCliOptions) => {
      const result = await runInstall({
        root: opts.root,
        ...(opts.tool === undefined ? {} : { tools: opts.tool as AiTool[] }),
        ...(opts.all === true ? { all: true } : {}),
        ...(opts.global === true ? { global: true } : {}),
        ...(opts.dryRun === true ? { dryRun: true } : {}),
        ...(opts.force === true ? { force: true } : {}),
        ...(opts.mcpCommand === undefined ? {} : { mcpCommand: opts.mcpCommand }),
      });
      process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatInstallSummary(result)}\n`);
      // 스킬·명령을 하나도 못 썼으면 설치가 안 된 것이다.
      if (result.allSkillsSkipped === true) process.exitCode = 1;
    });

  program
    .command("ai")
    .description(
      "이 레포의 DS에서 컴포넌트 카탈로그(.dsmith/catalog.json)를 만들고 AGENTS.md의 DS 섹션을 갱신. 사용자가 고친 섹션은 --force 없이 덮어쓰지 않음",
    )
    .option("--root <dir>", "대상 레포 경로", process.cwd())
    .option("--json", "결과를 JSON으로만 stdout에 출력")
    .option("--from <source>", `DS 소스(${AI_FROM.join(" | ")}). auto: detect.ds, 없으면 init 산출`, "auto")
    .option("--dry-run", "아무것도 쓰지 않고 쓸 내용과 diff만 출력")
    .option("--force", "사용자가 고친 DS 섹션도 덮어쓴다")
    .action(async (opts: AiCliOptions) => {
      if (!(AI_FROM as readonly string[]).includes(opts.from)) {
        throw new Error(`--from은 ${AI_FROM.join(" | ")} 중 하나여야 합니다: ${opts.from}`);
      }
      const result = await runAiCommand({
        root: opts.root,
        from: opts.from as (typeof AI_FROM)[number],
        ...(opts.dryRun === true ? { dryRun: true } : {}),
        ...(opts.force === true ? { force: true } : {}),
      });
      process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatAiSummary(result)}\n`);
    });

  program
    .command("init")
    .description(
      "audit 결과로 W3C 토큰 파일(tokens.json·css·ts)과 컴포넌트 스캐폴드를 만들고 커버리지를 보고한다. 사용자가 고친 토큰 파일은 --force 없이 덮어쓰지 않고, 기존 스캐폴드는 --force여도 덮어쓰지 않음",
    )
    .option("--root <dir>", "대상 레포 경로", process.cwd())
    .option("--json", "결과를 JSON으로만 stdout에 출력")
    .option("--out <dir>", "산출 디렉터리(레포 안 상대 경로, 기본 design-system)")
    .option("--all", "결정 없이 추천안으로 스캐폴드(상위 --top개)")
    .option("--top <n>", "--all에서 스캐폴드할 컴포넌트 수(기본 10)")
    .option("--dry-run", "아무것도 쓰지 않고 쓸 파일과 diff만 출력")
    .option("--force", "사용자가 고친 토큰 파일도 덮어쓴다(스캐폴드는 제외)")
    .action(async (opts: InitCliOptions) => {
      const { result, text } = await runInitCommand(opts);
      process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : `${text}\n`);
    });

  return program;
}
