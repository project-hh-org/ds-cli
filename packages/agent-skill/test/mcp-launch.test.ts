import { describe, expect, it } from "vitest";
import { defaultMcpLaunch, parseMcpCommand } from "../src/mcp-launch.js";

describe("defaultMcpLaunch", () => {
  it("0.x는 minor까지 고정한다", () => {
    expect(defaultMcpLaunch("0.2.0")).toEqual({ command: "npx", args: ["-y", "dsmith@0.2", "mcp"] });
    expect(defaultMcpLaunch("0.3.7").args[1]).toBe("dsmith@0.3");
  });

  it("1.x 이상은 major만 고정한다", () => {
    expect(defaultMcpLaunch("1.4.2").args[1]).toBe("dsmith@1");
    expect(defaultMcpLaunch("2.0.0").args[1]).toBe("dsmith@2");
  });

  it("prerelease 접미사가 있어도 숫자만 쓴다", () => {
    expect(defaultMcpLaunch("0.2.0-beta.1").args[1]).toBe("dsmith@0.2");
  });

  it("버전 형식이 아니면 Error", () => {
    expect(() => defaultMcpLaunch("latest")).toThrow(/버전/);
  });
});

describe("parseMcpCommand", () => {
  it("공백으로 나누고 끝에 mcp를 붙인다", () => {
    expect(parseMcpCommand("node /x/bin.js")).toEqual({ command: "node", args: ["/x/bin.js", "mcp"] });
  });

  it("여러 공백을 하나로 본다", () => {
    expect(parseMcpCommand("  node   /x/bin.js ")).toEqual({ command: "node", args: ["/x/bin.js", "mcp"] });
  });

  it("명령만 있어도 된다", () => {
    expect(parseMcpCommand("dsmith")).toEqual({ command: "dsmith", args: ["mcp"] });
  });

  it("빈 문자열은 Error", () => {
    expect(() => parseMcpCommand("  ")).toThrow();
  });
});
