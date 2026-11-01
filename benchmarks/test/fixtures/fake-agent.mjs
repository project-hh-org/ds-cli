// 가짜 에이전트 — 테스트 전용. 프롬프트(stdin)의 src/components/*.tsx 경로에 정해진 파일을 쓰고
// claude stream-json 모양의 줄들을 stdout에 낸다. 실제 모델·네트워크 없음.
//   FAKE_AGENT_MODE=baseline|dsmith  (없으면 cwd에 AGENTS.md가 있으면 dsmith, 없으면 baseline)
//   FAKE_AGENT_SLEEP_MS=<ms>         쓰기 전에 이만큼 기다림(timeout 테스트)
//   FAKE_AGENT_EXIT=<code>           쓰고 나서 그 코드로 종료
import fs from "node:fs";
import path from "node:path";

const prompt = fs.readFileSync(0, "utf-8");
const sleepMs = Number(process.env.FAKE_AGENT_SLEEP_MS ?? "0");
if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));

const cwd = process.cwd();
const mode = process.env.FAKE_AGENT_MODE ?? (fs.existsSync(path.join(cwd, "AGENTS.md")) ? "dsmith" : "baseline");
const target = /src\/components\/[\w./-]+\.tsx/.exec(prompt)?.[0];

const BASELINE = `function Button({ children }: { children: string }) {
  return <button className="rounded-md bg-[#3b82f6] px-4 py-2 text-white">{children}</button>;
}

export function Generated() {
  return (
    <div className="p-4 text-gray-700">
      <Button>저장</Button>
    </div>
  );
}
`;

const DSMITH = `import { Button } from "@/components/ui/button";

export function Generated() {
  return (
    <div className="p-[var(--space-4)] text-[color:var(--color-blue-900)]">
      <Button>저장</Button>
    </div>
  );
}
`;

if (target !== undefined) {
  fs.mkdirSync(path.dirname(path.join(cwd, target)), { recursive: true });
  fs.writeFileSync(path.join(cwd, target), mode === "dsmith" ? DSMITH : BASELINE);
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, file), "utf-8"));
  } catch {
    return null;
  }
};
const agents = fs.existsSync(path.join(cwd, "AGENTS.md")) ? fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf-8") : null;

// 테스트가 단언할 환경 정보 한 줄
process.stdout.write(
  `${JSON.stringify({
    type: "fake-env",
    cwd,
    mode,
    target: target ?? null,
    entries: fs.readdirSync(cwd).sort(),
    agentsMd: agents,
    hasDsmithDir: fs.existsSync(path.join(cwd, ".dsmith")),
    hasCatalog: fs.existsSync(path.join(cwd, ".dsmith/catalog.json")),
    hasBenchmarksDir: fs.existsSync(path.join(cwd, "benchmarks")),
    mcp: readJson(".mcp.json"),
    claudeEnvKeys: Object.keys(process.env).filter((k) => k.startsWith("CLAUDE")).length,
  })}\n`,
);
process.stdout.write(
  `${JSON.stringify({ type: "result", subtype: "success", num_turns: 1, total_cost_usd: 0.001, modelUsage: { "fake-model": {} }, permission_denials: [], is_error: false })}\n`,
);

const exit = process.env.FAKE_AGENT_EXIT;
if (exit !== undefined) process.exit(Number(exit));
