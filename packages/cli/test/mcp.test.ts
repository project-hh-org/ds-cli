import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { TOOL_NAMES } from "@dsmith-dev/mcp-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAiCommand } from "../src/commands/ai.js";
import { runAudit } from "../src/commands/audit.js";
import { runInstall } from "../src/commands/install.js";
import { findProjectRoot } from "../src/commands/mcp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const bin = path.resolve(here, "../dist/bin.js");

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-mcp-cli-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function copyFixture(name: string): string {
  const dest = path.join(tmp, name);
  fs.cpSync(path.join(repoRoot, "fixtures", name), dest, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes(".dsmith"),
  });
  return dest;
}

describe("findProjectRoot", () => {
  it(".dsmith 또는 .git이 있는 가장 가까운 조상, 없으면 시작 디렉터리", () => {
    const repo = path.join(tmp, "repo");
    const deep = path.join(repo, "packages", "app", "src");
    fs.mkdirSync(deep, { recursive: true });
    fs.mkdirSync(path.join(repo, ".git"));
    expect(findProjectRoot(deep)).toBe(repo);

    // 빈 .dsmith/나 install.json만 있는 .dsmith/는 근거가 아니다
    fs.mkdirSync(path.join(repo, "packages", "app", ".dsmith"));
    expect(findProjectRoot(deep)).toBe(repo);
    fs.writeFileSync(path.join(repo, "packages", "app", ".dsmith", "install.json"), "{}");
    expect(findProjectRoot(deep)).toBe(repo);
    fs.writeFileSync(path.join(repo, "packages", "app", ".dsmith", "detect.json"), "{}");
    expect(findProjectRoot(deep)).toBe(path.join(repo, "packages", "app"));

    const lone = path.join(tmp, "lone", "x");
    fs.mkdirSync(lone, { recursive: true });
    expect(findProjectRoot(lone)).toBe(lone);
  });

  it("install --global이 홈에 남긴 .dsmith/install.json은 레포 근거가 아니다 — 홈 아래 폴더에서 띄우면 그 폴더", async () => {
    const home = path.join(tmp, "home");
    const other = path.join(tmp, "somewhere");
    fs.mkdirSync(path.join(home, "notes", "proto"), { recursive: true });
    fs.mkdirSync(other);
    await runInstall({ root: other, home, global: true, tools: ["claude-code"], version: "0.2.0" });
    expect(fs.existsSync(path.join(home, ".dsmith", "install.json"))).toBe(true);
    const sub = path.join(home, "notes", "proto");
    expect(findProjectRoot(sub, home)).toBe(sub);
    // 홈에 detect.json·index.json이 있어도(예전에 홈에서 audit한 경우) .git이 없으면 홈을 고르지 않는다
    fs.writeFileSync(path.join(home, ".dsmith", "index.json"), "{}");
    fs.writeFileSync(path.join(home, ".dsmith", "detect.json"), "{}");
    expect(findProjectRoot(sub, home)).toBe(sub);
    // 홈이 .git 레포(dotfiles)면 레포로 본다
    fs.mkdirSync(path.join(home, ".git"));
    expect(findProjectRoot(sub, home)).toBe(home);
  });

  it("os.homedir() 기본값은 HOME 환경변수를 따른다", async () => {
    const home = path.join(tmp, "envhome");
    fs.mkdirSync(path.join(home, ".dsmith"), { recursive: true });
    fs.writeFileSync(path.join(home, ".dsmith", "detect.json"), "{}");
    fs.mkdirSync(path.join(home, "work"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    try {
      expect(findProjectRoot(path.join(home, "work"))).toBe(path.join(home, "work"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("레포 모드 install 뒤: audit 전에는 시작 디렉터리, audit(detect.json·index.json) 뒤에는 그 레포", async () => {
    const repo = path.join(tmp, "plain");
    const deep = path.join(repo, "src", "ui");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "app", dependencies: { react: "^18" } }));
    fs.writeFileSync(path.join(repo, "src", "A.tsx"), "export const A = () => <div />;\n");
    await runInstall({ root: repo, home: path.join(tmp, "h"), tools: ["claude-code"], version: "0.2.0" });
    expect(fs.existsSync(path.join(repo, ".dsmith", "install.json"))).toBe(true);
    expect(findProjectRoot(deep, path.join(tmp, "h"))).toBe(deep);
    await runAudit(repo);
    expect(findProjectRoot(deep, path.join(tmp, "h"))).toBe(repo);
  });

  it(".git이 파일(워크트리·서브모듈)이어도 루트로 본다", () => {
    const wt = path.join(tmp, "wt");
    fs.mkdirSync(path.join(wt, "src"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".git"), "gitdir: /elsewhere\n");
    expect(findProjectRoot(path.join(wt, "src"))).toBe(wt);
  });
});

describe("dsmith mcp (실제 stdio)", () => {
  it("--root로 서버를 띄우면 도구 6개, 호출 성공, 인덱스를 1회 만들고 stderr에 root=", async () => {
    const root = copyFixture("with-ds-app");
    expect(fs.existsSync(path.join(root, ".dsmith", "index.json"))).toBe(false);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin, "mcp", "--root", root, "--no-git"],
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const client = new Client({ name: "test", version: "0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
      const res = await client.callTool({ name: "explain_decision", arguments: { item: "Button" } });
      expect(res.isError).not.toBe(true);
      const text = (res.content as { text: string }[])[0]?.text ?? "";
      expect(JSON.parse(text)).toMatchObject({ item: "Button", kind: "duplicate" });
    } finally {
      await client.close();
    }
    expect(fs.existsSync(path.join(root, ".dsmith", "index.json"))).toBe(true);
    expect(stderr).toContain(`root=${root}`);
  }, 30_000);

  it("audit → ai 뒤에 띄운 서버는 get_component가 카탈로그에서 답한다", async () => {
    const root = copyFixture("with-ds-app");
    fs.writeFileSync(
      path.join(root, "components", "ui", "Badge.tsx"),
      'export interface BadgeProps {\n  /** 색 톤 */\n  tone?: "neutral" | "danger";\n}\n\nexport function Badge({ tone }: BadgeProps) {\n  return <span data-tone={tone} />;\n}\n',
    );
    await runAudit(root);
    const ai = await runAiCommand({ root });
    expect(ai.components).toBeGreaterThanOrEqual(2);
    const transport = new StdioClientTransport({ command: process.execPath, args: [bin, "mcp", "--root", root, "--no-git"], stderr: "pipe" });
    const client = new Client({ name: "test", version: "0" });
    try {
      await client.connect(transport);
      const res = await client.callTool({ name: "get_component", arguments: { name: "Button" } });
      expect(res.isError).not.toBe(true);
      const out = JSON.parse((res.content as { text: string }[])[0]?.text ?? "{}");
      expect(out).toMatchObject({ name: "Button", module: "components/ui/Button", source: "catalog", origin: "ds-local" });
      const badge = JSON.parse(((await client.callTool({ name: "get_component", arguments: { name: "Badge" } })).content as { text: string }[])[0]?.text ?? "{}");
      expect(badge).toMatchObject({ source: "catalog", usage: { count: 0, files: [] } });
      expect(badge.props.map((p: { name: string }) => p.name)).toContain("tone");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("--root 없이 하위 디렉터리에서 띄우면 .git이 있는 조상을 root로 쓴다", async () => {
    const root = copyFixture("with-ds-app");
    fs.mkdirSync(path.join(root, ".git"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin, "mcp", "--no-git"],
      cwd: path.join(root, "src", "pages"),
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const client = new Client({ name: "test", version: "0" });
    try {
      await client.connect(transport);
      await client.listTools();
      await client.callTool({ name: "list_decisions", arguments: {} });
    } finally {
      await client.close();
    }
    expect(stderr).toContain(`root=${root}`);
    expect(fs.existsSync(path.join(root, ".dsmith", "index.json"))).toBe(true);
  }, 30_000);

  it("인덱스가 없어도 핸드셰이크는 audit을 기다리지 않고(<2s), 첫 도구 호출이 audit을 만든다", async () => {
    const root = copyFixture("with-ds-app");
    const transport = new StdioClientTransport({ command: process.execPath, args: [bin, "mcp", "--root", root, "--no-git"], stderr: "pipe" });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const client = new Client({ name: "test", version: "0" });
    try {
      const t0 = Date.now();
      await client.connect(transport);
      const handshakeMs = Date.now() - t0;
      expect(handshakeMs).toBeLessThan(2000);
      expect(stderr).toContain(`root=${root}`);
      // 연결만으로는 audit이 시작되지 않는다.
      expect(fs.existsSync(path.join(root, ".dsmith", "index.json"))).toBe(false);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(6);
      expect(fs.existsSync(path.join(root, ".dsmith", "index.json"))).toBe(false);
      const res = await client.callTool({ name: "list_decisions", arguments: {} });
      expect(res.isError).not.toBe(true);
      expect(fs.existsSync(path.join(root, ".dsmith", "index.json"))).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("stdout에는 JSON-RPC 줄만 나온다", async () => {
    const root = copyFixture("with-ds-app");
    const child = spawn(process.execPath, [bin, "mcp", "--root", root, "--no-git"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    const send = (msg: object): void => void child.stdin.write(`${JSON.stringify(msg)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_decisions", arguments: {} } });
    const seen = (): number => stdout.split("\n").filter((l) => l.trim() !== "").length;
    const deadline = Date.now() + 20_000;
    while (seen() < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    child.kill();
    const lines = stdout.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      const msg = JSON.parse(line) as { jsonrpc?: string };
      expect(msg.jsonrpc).toBe("2.0");
    }
  }, 30_000);

  it("--budget이 정수가 아니면 오류로 끝난다(stdout 비어 있음)", async () => {
    const child = spawn(process.execPath, [bin, "mcp", "--root", tmp, "--budget", "abc"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("--budget");
  }, 30_000);
});
