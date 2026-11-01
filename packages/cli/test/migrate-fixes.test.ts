import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readIndex } from "@dsmith-dev/core";
import { runAudit } from "../src/commands/audit.js";
import { runDecideChoose } from "../src/commands/decide.js";
import { runMigrateCommand } from "../src/commands/migrate.js";

// applyMigration만 시험용으로 갈아 끼울 수 있게 한다(mode가 "real"이면 진짜)
const fake = vi.hoisted(() => ({ mode: "real" as "real" | "all-failed" | "throw" }));
vi.mock("@dsmith-dev/migrate", async (importOriginal) => {
  const original = await importOriginal<typeof import("@dsmith-dev/migrate")>();
  return {
    ...original,
    applyMigration: async (...args: Parameters<typeof original.applyMigration>) => {
      if (fake.mode === "throw") throw new Error("기록을 쓰지 못함(시험용)");
      const result = await original.applyMigration(...args);
      if (fake.mode === "all-failed") return { ...result, files: result.files.map((f) => ({ ...f, status: "rolled-back" as const })) };
      return result;
    },
  };
});

const SHADCN_BUTTON = `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva("inline-flex", {
  variants: {
    variant: { default: "a", destructive: "b", outline: "c" },
    size: { default: "d", sm: "e", lg: "f" },
  },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  return <button className={buttonVariants({ variant, size, className })} {...props} />;
}
`;

const LEGACY_BUTTON = `import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string };

export function Button(props: Props) {
  return <button {...props} />;
}
`;

const DS = "src/components/ui/button";
const PAGE = "app/page.tsx";

const tmps: string[] = [];
const saved: Record<string, string | undefined> = {};
const KEYS = ["HOME", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME", "EMAIL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
beforeEach(() => {
  fake.mode = "real";
  for (const k of KEYS) saved[k] = process.env[k];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-fixes-home-"));
  tmps.push(home);
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = path.join(home, "nope");
  for (const k of ["EMAIL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const t of tmps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): string =>
  spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args], { cwd, encoding: "utf-8" }).stdout;

async function repo(files: Record<string, string> = {}): Promise<string> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-fixes-")));
  tmps.push(root);
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "x", dependencies: { react: "18" } }),
    "styles/tokens.css": ":root { --color-brand: #3b82f6; --space-4: 16px; --radius-sm: 4px; }\n",
    "src/components/Button.tsx": LEGACY_BUTTON,
    [`${DS}.tsx`]: SHADCN_BUTTON,
    [PAGE]: `import { Button } from "../src/components/Button";\n\nexport const P = () => <Button variant="outline" size="sm">a</Button>;\n`,
    "app/ok.tsx": `import { Button } from "../src/components/ui/button";\n\nexport const Q = () => <Button variant="destructive">x</Button>;\n`,
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  await runAudit(root);
  return root;
}

function gitInit(root: string): void {
  fs.writeFileSync(path.join(root, ".gitignore"), ".dsmith/\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  git(root, "config", "user.name", "Repo Author");
  git(root, "config", "user.email", "repo@example.com");
}

describe("shadcn/cva 스타일 DS 버튼 (e2e)", { timeout: 60_000 }, () => {
  it("cva variants를 풀어 mapping 없이 import가 바뀌고, 재audit에서 Button 사용처가 DS module뿐이다", async () => {
    const root = await repo();
    await runDecideChoose(root, "Button", DS);
    const plan = await runMigrateCommand({ root, only: "components" });
    const json = plan.json as { plan: { componentHeld: unknown[]; components: { imports: number; held: object } } };
    expect(json.plan.componentHeld).toEqual([]);
    expect(json.plan.components).toMatchObject({ decided: 1, imports: 1, held: {} });

    await runMigrateCommand({ root, only: "components", apply: true });
    expect(fs.readFileSync(path.join(root, PAGE), "utf-8")).toContain('import { Button } from "../src/components/ui/button";');
    const index = (await readIndex(root))!;
    expect([...new Set(index.components.filter((c) => c.name === "Button").map((c) => c.module))]).toEqual([DS]);
  });

  it("cva 밖의 값(variant=\"secondary\")과 표현식 값은 보류하고 detail에 값이 나온다", async () => {
    const root = await repo({ [PAGE]: `import { Button } from "../src/components/Button";\n\nexport const P = (d: boolean) => <Button variant={d ? "outline" : "secondary"}>a</Button>;\n` });
    await runDecideChoose(root, "Button", DS);
    const out = await runMigrateCommand({ root, only: "components" });
    const held = (out.json as { plan: { componentHeld: { reason: string; detail: string }[] } }).plan.componentHeld;
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ reason: "mapping-missing" });
    expect(held[0]?.detail).toContain('variant="secondary"');
  });
});

describe("decide --choose (mapping 유지, M6)", { timeout: 60_000 }, () => {
  it("--map 없이 다시 고르면 기존 mapping을 유지하고 알린다", async () => {
    const root = await repo();
    const first = await runDecideChoose(root, "Button", DS, undefined, { mapping: { kind: "variant" } });
    expect(first.mapping).toEqual({ kind: "variant" });
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const again = await runDecideChoose(root, "Button", DS, "메모");
      expect(again.mapping).toEqual({ kind: "variant" });
      expect(write).toHaveBeenCalledWith(expect.stringContaining("기존 mapping 유지 (--map으로 바꿀 수 있음)"));
      write.mockClear();
      await runDecideChoose(root, "Button", DS, "메모", { mapping: { kind: "tone" } });
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});

describe("--apply --branch 가장자리 (M8 · M9)", { timeout: 90_000 }, () => {
  it("대상 파일이 .gitignore에 걸리면 쓰기 전에 오류", async () => {
    const root = await repo();
    await runDecideChoose(root, "Button", DS);
    gitInit(root);
    fs.writeFileSync(path.join(root, ".gitignore"), `.dsmith/\n${PAGE}\n`);
    git(root, "rm", "--cached", "-q", PAGE);
    git(root, "add", ".gitignore");
    git(root, "commit", "-q", "-m", "ignore page");
    const before = fs.readFileSync(path.join(root, PAGE), "utf-8");
    await expect(runMigrateCommand({ root, apply: true, only: "components", branch: "ds/x" })).rejects.toThrow(/\.gitignore에 걸려.*app\/page\.tsx/);
    expect(fs.readFileSync(path.join(root, PAGE), "utf-8")).toBe(before);
    expect(git(root, "branch", "--list", "ds/x").trim()).toBe("");
  });

  it("적용된 파일이 없어 브랜치를 없애면 기록의 branch는 null이고 이유가 남는다", async () => {
    const root = await repo();
    await runDecideChoose(root, "Button", DS);
    gitInit(root);
    fake.mode = "all-failed";
    const out = await runMigrateCommand({ root, apply: true, only: "components", branch: "ds/none" });
    expect(out.exitCode).toBe(1);
    expect(out.text).toContain("적용된 파일이 없어 브랜치 ds/none를 만들지 않음");
    expect(git(root, "branch", "--show-current").trim()).toBe("main");
    expect(git(root, "branch", "--list", "ds/none").trim()).toBe("");
    const applied = (out.json as { applied: { record: string }; branch: unknown }).applied;
    const record = JSON.parse(fs.readFileSync(path.join(root, applied.record), "utf-8"));
    expect(record.branch).toBeNull();
    expect(record.branchNote).toContain("ds/none");
    expect((out.json as { branch: unknown }).branch).toBeNull();
  });

  it("브랜치를 만든 뒤 오류가 나면 오류에 브랜치 이름과 base가 붙는다", async () => {
    const root = await repo();
    await runDecideChoose(root, "Button", DS);
    gitInit(root);
    fake.mode = "throw";
    await expect(runMigrateCommand({ root, apply: true, only: "components", branch: "ds/boom" })).rejects.toThrow(/기록을 쓰지 못함.*\n브랜치 ds\/boom가 만들어져 체크아웃된 상태.*base: main/);
    expect(git(root, "branch", "--show-current").trim()).toBe("ds/boom");
  });
});

describe("--max-files (M12)", { timeout: 60_000 }, () => {
  it("컴포넌트 편집만 있는 파일도 한도에 세고, 빠진 편집 건수를 알린다", async () => {
    const root = await repo({
      "app/two.tsx": `import { Button } from "../src/components/Button";\n\nexport const T = () => <Button size="lg">b</Button>;\n`,
    });
    await runDecideChoose(root, "Button", DS);
    const out = await runMigrateCommand({ root, only: "components", maxFiles: "1" });
    const plan = (out.json as { plan: { files: { file: string }[]; notes: string[] } }).plan;
    expect(plan.files).toHaveLength(1);
    expect(plan.notes.join("\n")).toMatch(/범위 제한으로 1개 파일 제외 \(컴포넌트 import 1 포함\)/);
  });
});
