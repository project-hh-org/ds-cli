import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizePackageSpecifier, readTsconfigPaths, resolveWithPaths } from "../src/index.js";

describe("normalizePackageSpecifier", () => {
  it.each([
    ["@mui/material/Button", "@mui/material"],
    ["@mui/material", "@mui/material"],
    ["@radix-ui/react-dialog", "@radix-ui/react-dialog"],
    ["lodash/fp", "lodash"],
    ["next/link", "next"],
    ["react-dom/client", "react-dom"],
    ["react", "react"],
    ["./x", "./x"],
    ["../x/y", "../x/y"],
    ["/x/y", "/x/y"],
    ["@/components/x", "@/components/x"],
    ["~/components/x", "~/components/x"],
  ])("%s → %s", (spec, expected) => {
    expect(normalizePackageSpecifier(spec)).toBe(expected);
  });
});

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-tsconfig-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function put(rel: string, content: string): void {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const CHILD = `{
  // 주석과 끝 쉼표가 있는 JSONC
  "extends": "./tsconfig.base.json",
  /* 블록 주석 */
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "components/*": ["./src/components/*"],
      "~ui": ["./src/ui/index.ts"], // 정확 일치 키
    },
  },
}`;

describe("readTsconfigPaths", () => {
  it("주석·끝 쉼표를 걷어내고 extends 한 단계를 따라가 baseUrl과 paths를 합친다", async () => {
    put("tsconfig.base.json", `{ "compilerOptions": { "baseUrl": "." } }`);
    put("tsconfig.json", CHILD);
    expect(await readTsconfigPaths(tmp)).toEqual({
      baseUrl: "",
      paths: {
        "@/*": ["./src/*"],
        "components/*": ["./src/components/*"],
        "~ui": ["./src/ui/index.ts"],
      },
    });
  });

  it("문자열 안의 // 와 /* 는 주석으로 보지 않는다", async () => {
    put("tsconfig.json", `{ "compilerOptions": { "paths": { "x//*": ["./a/*/*"] } } }`);
    expect(await readTsconfigPaths(tmp)).toEqual({ baseUrl: "", paths: { "x//*": ["./a/*/*"] } });
  });

  it("자식 paths는 부모 paths를 통째로 대체하고, 부모 baseUrl은 부모 파일 기준으로 푼다", async () => {
    put("configs/base.json", `{ "compilerOptions": { "baseUrl": "..", "paths": { "old/*": ["./old/*"] } } }`);
    put("tsconfig.json", `{ "extends": "./configs/base", "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`);
    expect(await readTsconfigPaths(tmp)).toEqual({ baseUrl: "", paths: { "@/*": ["./src/*"] } });
  });

  it("node_modules 안의 extends 대상을 읽는다", async () => {
    put("node_modules/@acme/tsconfig/base.json", `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`);
    put("tsconfig.json", `{ "extends": "@acme/tsconfig/base.json", "compilerOptions": { "baseUrl": "." } }`);
    const result = await readTsconfigPaths(tmp);
    expect(result).toEqual({ baseUrl: "", paths: { "@/*": ["./src/*"] } });
  });

  it("읽을 수 없는 extends는 무시한다", async () => {
    put("tsconfig.json", `{ "extends": "./missing.json", "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`);
    expect(await readTsconfigPaths(tmp)).toEqual({ baseUrl: "", paths: { "@/*": ["./src/*"] } });
  });

  it("baseUrl이 하위 디렉터리면 root 상대 경로로 돌려준다", async () => {
    put("tsconfig.json", `{ "compilerOptions": { "baseUrl": "./src", "paths": { "@/*": ["./*"] } } }`);
    expect(await readTsconfigPaths(tmp)).toEqual({ baseUrl: "src", paths: { "@/*": ["./*"] } });
  });

  it("tsconfig.json이 없으면 jsconfig.json을 읽는다", async () => {
    put("jsconfig.json", `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`);
    expect(await readTsconfigPaths(tmp)).toEqual({ baseUrl: "", paths: { "@/*": ["./src/*"] } });
  });

  it("설정 파일이 없으면 null", async () => {
    expect(await readTsconfigPaths(tmp)).toBeNull();
  });

  it("paths가 없으면 null", async () => {
    put("tsconfig.json", `{ "compilerOptions": { "baseUrl": "." } }`);
    expect(await readTsconfigPaths(tmp)).toBeNull();
  });

  it("JSON이 깨졌으면 예외 없이 null", async () => {
    put("tsconfig.json", `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] `);
    expect(await readTsconfigPaths(tmp)).toBeNull();
  });

  it("최상위가 객체가 아니면 null", async () => {
    put("tsconfig.json", `[1, 2]`);
    expect(await readTsconfigPaths(tmp)).toBeNull();
  });
});

describe("resolveWithPaths", () => {
  const tp = {
    baseUrl: "",
    paths: {
      "@/*": ["./src/*"],
      "components/*": ["./src/components/*"],
      "~ui": ["./src/ui/index.ts"],
    },
  };

  it("와일드카드 키를 첫 번째 대상으로 푼다", () => {
    expect(resolveWithPaths("components/ui/button", "app/page.tsx", tp)).toBe("src/components/ui/button");
    expect(resolveWithPaths("@/ui/button", "app/page.tsx", tp)).toBe("src/ui/button");
  });

  it("정확 일치 키를 풀고 확장자와 /index를 뗀다", () => {
    expect(resolveWithPaths("~ui", "app/page.tsx", tp)).toBe("src/ui");
  });

  it("일치하는 키가 없으면 null", () => {
    expect(resolveWithPaths("react", "app/page.tsx", tp)).toBeNull();
    expect(resolveWithPaths("@/x", "app/page.tsx", null)).toBeNull();
  });

  it("정확 일치 키가 와일드카드보다, 긴 접두사가 짧은 접두사보다 먼저다", () => {
    const paths = {
      baseUrl: "",
      paths: { "@/*": ["./src/*"], "@/ui/*": ["./packages/ui/*"], "@/ui/button": ["./vendor/button.tsx"] },
    };
    expect(resolveWithPaths("@/ui/card", "a.tsx", paths)).toBe("packages/ui/card");
    expect(resolveWithPaths("@/ui/button", "a.tsx", paths)).toBe("vendor/button");
    expect(resolveWithPaths("@/lib/x", "a.tsx", paths)).toBe("src/lib/x");
  });

  it("baseUrl을 앞에 붙인다", () => {
    expect(resolveWithPaths("@/ui/button.tsx", "a.tsx", { baseUrl: "src", paths: { "@/*": ["./*"] } })).toBe(
      "src/ui/button",
    );
  });

  it("대상의 /index 파일은 디렉터리로 줄인다", () => {
    expect(resolveWithPaths("@/ui/index", "a.tsx", tp)).toBe("src/ui");
  });
});
