import { formatInitSummary, runInit, type InitResult } from "@dsmith-dev/init";
import { cliVersion } from "../version.js";

export interface InitCommandOptions {
  root: string;
  out?: string | undefined;
  all?: boolean | undefined;
  top?: string | undefined;
  dryRun?: boolean | undefined;
  force?: boolean | undefined;
  json?: boolean | undefined;
}

export interface InitCommandOutput {
  result: InitResult;
  text: string;
}

/** `dsmith init`: 옵션을 검증해 `runInit`을 부르고 사람용 요약을 만든다. */
export async function runInitCommand(opts: InitCommandOptions): Promise<InitCommandOutput> {
  let top: number | undefined;
  if (opts.top !== undefined) {
    top = Number(opts.top);
    if (!Number.isInteger(top) || top < 1) throw new Error(`--top은 1 이상의 정수여야 합니다: ${opts.top}`);
    if (opts.all !== true) throw new Error("--top은 --all과 함께 씁니다");
  }
  const result = await runInit({
    root: opts.root,
    version: cliVersion(),
    ...(opts.out === undefined ? {} : { outDir: opts.out }),
    ...(opts.all === true ? { all: true } : {}),
    ...(top === undefined ? {} : { top }),
    ...(opts.dryRun === true ? { dryRun: true } : {}),
    ...(opts.force === true ? { force: true } : {}),
  });
  return { result, text: formatInitSummary(result) };
}
