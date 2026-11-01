#!/usr/bin/env node
import { buildProgram } from "./program.js";

try {
  await buildProgram().parseAsync(process.argv);
} catch (err) {
  // commander의 --help/--version 종료는 exitOverride로 CommanderError(exitCode 0)가 된다.
  const exitCode = (err as { exitCode?: number }).exitCode;
  if (typeof exitCode === "number") process.exitCode = exitCode;
  else {
    process.stderr.write(`오류: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
