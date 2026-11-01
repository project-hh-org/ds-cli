import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexRepo, type Index } from "@dsmith-dev/core";
import { detect, type DetectResult } from "@dsmith-dev/detect";
import { metaOf, type Extractor } from "@dsmith-dev/extractor-api";
import { cssExtractor } from "@dsmith-dev/extractor-css";
import { emotionExtractor } from "@dsmith-dev/extractor-emotion";
import { inlineStyleExtractor } from "@dsmith-dev/extractor-inline-style";
import { muiSxExtractor } from "@dsmith-dev/extractor-mui-sx";
import { styledExtractor } from "@dsmith-dev/extractor-styled";
import { tailwindExtractor } from "@dsmith-dev/extractor-tailwind";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ALL_EXTRACTORS: Extractor[] = [
  inlineStyleExtractor,
  tailwindExtractor,
  cssExtractor,
  styledExtractor,
  emotionExtractor,
  muiSxExtractor,
];

/** fixtures/<name> → 임시 디렉터리 복사(.dsmith 제외). overlay = 상대 경로 → 파일 내용. 원본은 수정하지 않는다 */
export function copyFixture(name: string, overlay: Record<string, string> = {}): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-catalog-"));
  fs.cpSync(path.join(REPO_ROOT, "fixtures", name), tmp, {
    recursive: true,
    filter: (p) => !p.split(path.sep).includes(".dsmith"),
  });
  for (const [file, content] of Object.entries(overlay)) {
    const target = path.join(tmp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
  }
  return tmp;
}

/** fixtures/npm-types/<name> → <root>/node_modules/@mui/material */
export function installMui(root: string, name: "mui-material-6" | "mui-material-9"): void {
  fs.cpSync(path.join(REPO_ROOT, "fixtures", "npm-types", name), path.join(root, "node_modules", "@mui", "material"), {
    recursive: true,
  });
}

export async function auditFixture(root: string): Promise<{ index: Index; detect: DetectResult }> {
  const available = ALL_EXTRACTORS.map(metaOf);
  const provisional = await detect(root, undefined, { available });
  const index = await indexRepo(
    root,
    ALL_EXTRACTORS.filter((e) => provisional.activeExtractors.includes(e.name)),
  );
  return { index, detect: await detect(root, index, { available }) };
}

/** 임의 파일 트리를 임시 디렉터리에 쓴다 */
export function tmpTree(files: Record<string, string>): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-catalog-tree-"));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(tmp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
  }
  return tmp;
}
export const BADGE = `import type { ReactNode } from "react";

/** 상태 배지. */
export function Badge({ children }: BadgeProps) {
  return <span className="text-xs">{children}</span>;
}

export interface BadgeProps {
  /** 색 톤 */
  tone?: "neutral" | "danger";
  children?: ReactNode;
}
`;
export const OLD_BUTTON = `/** @deprecated Button을 쓰세요 */
export function OldButton() {
  return null;
}
`;
export const BUTTON_STORIES = `import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta = { component: Button } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { children: "저장" } };
export const Secondary: Story = { args: { children: "취소" } };
`;

export const overlay = {
  "components/ui/Badge.tsx": BADGE,
  "components/ui/OldButton.tsx": OLD_BUTTON,
  "components/ui/Button.stories.tsx": BUTTON_STORIES,
};
