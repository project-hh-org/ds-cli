import { resolveWithPaths, type TsPaths } from "@dsmith-dev/core";
import { describe, expect, it } from "vitest";
import { specifierForModule } from "../src/specifier.js";

const alias: TsPaths = { baseUrl: "", baseUrlExplicit: true, paths: { "@/*": ["./src/*"] } };

describe("specifierForModule", () => {
  it("tsconfig paths 별칭이 module을 덮으면 별칭을 쓴다", () => {
    expect(specifierForModule("app/page.tsx", "src/components/ui/button", alias)).toBe("@/components/ui/button");
    expect(resolveWithPaths("@/components/ui/button", "app/page.tsx", alias)).toBe("src/components/ui/button");
  });

  it("별칭이 없으면 importer 기준 상대 경로(./·../ 접두, 확장자 없음)", () => {
    expect(specifierForModule("src/pages/a.tsx", "src/components/ui/button", null)).toBe("../components/ui/button");
    expect(specifierForModule("src/components/a.tsx", "src/components/ui/button", null)).toBe("./ui/button");
    expect(specifierForModule("app/page.tsx", "src/components/ui/button", { baseUrl: "", paths: {} })).toBe("../src/components/ui/button");
  });

  it("별칭 대상 밖의 module은 상대 경로로 간다", () => {
    expect(specifierForModule("app/page.tsx", "lib/ui/button", alias)).toBe("../lib/ui/button");
  });

  it("패키지는 그대로", () => {
    expect(specifierForModule("app/page.tsx", "@acme/ds", alias)).toBe("@acme/ds");
    expect(specifierForModule("app/page.tsx", "antd", alias)).toBe("antd");
  });

  it("isPath를 주면 추측하지 않는다", () => {
    expect(specifierForModule("src/a.tsx", "ds", null, true)).toBe("../ds");
    expect(specifierForModule("src/a.tsx", "components/ui/button", null, false)).toBe("components/ui/button");
  });

  it("baseUrl이 src면 별칭 키가 src 아래 module을 덮는다", () => {
    const paths: TsPaths = { baseUrl: "src", baseUrlExplicit: true, paths: { "~/*": ["*"] } };
    // 대상 "*"는 baseUrl(src) 아래 전체
    expect(specifierForModule("src/a.tsx", "src/ui/button", paths)).toBe("~/ui/button");
  });

  it("정확 일치 별칭 키도 쓴다", () => {
    const exact: TsPaths = { baseUrl: "", paths: { "@ds": ["./src/ds/index.ts"] } };
    expect(specifierForModule("src/a.tsx", "src/ds", exact)).toBe("@ds");
  });
});
