import fs from "node:fs";

/** cli `package.json`의 version. 읽지 못하면 "0.0.0"(로컬 개발 취급). dist/·src/ 어디서든 패키지 루트를 가리킨다. */
export function cliVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
