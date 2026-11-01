import { formatAiSummary, runAi, type AiResult } from "@dsmith-dev/catalog";
import { cliVersion } from "../version.js";

export { formatAiSummary };
export type { AiResult };

export interface AiCommandOptions {
  root: string;
  from?: "auto" | "ds" | "init";
  dryRun?: boolean;
  force?: boolean;
  /** 테스트 주입. 기본: cli package.json version */
  version?: string;
}

export const AI_FROM = ["auto", "ds", "init"] as const;

export function runAiCommand(opts: AiCommandOptions): Promise<AiResult> {
  return runAi({
    root: opts.root,
    version: opts.version ?? cliVersion(),
    ...(opts.from === undefined ? {} : { from: opts.from }),
    ...(opts.dryRun === true ? { dryRun: true } : {}),
    ...(opts.force === true ? { force: true } : {}),
  });
}
