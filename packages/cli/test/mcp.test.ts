import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { TOOL_NAMES } from "@dsmith-dev/mcp-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

    fs.mkdirSync(path.join(repo, "packages", "app", ".dsmith"));
    expect(findProjectRoot(deep)).toBe(path.join(repo, "packages", "app"));

    const lone = path.join(tmp, "lone", "x");
    fs.mkdirSync(lone, { recursive: true });
    expect(findProjectRoot(lone)).toBe(lone);
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

  it("인덱스가 없어도 핸드셰이크는 audit을 기다리지 않고(<1s), 첫 도구 호출이 audit을 만든다", async () => {
    const root = copyFixture("with-ds-app");
    const transport = new StdioClientTransport({ command: process.execPath, args: [bin, "mcp", "--root", root, "--no-git"], stderr: "pipe" });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const client = new Client({ name: "test", version: "0" });
    try {
      const t0 = Date.now();
      await client.connect(transport);
      const handshakeMs = Date.now() - t0;
      expect(handshakeMs).toBeLessThan(1000);
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
