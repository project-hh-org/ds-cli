import { describe, expect, it } from "vitest";
import { findStories, storyExample } from "../src/index.js";
import { BUTTON_STORIES, tmpTree } from "./helpers.js";


describe("stories", () => {
  it("meta component 이름 → 없으면 파일명 앞부분", async () => {
    const root = tmpTree({
      "ui/Button.stories.tsx": BUTTON_STORIES,
      "ui/Card.stories.tsx": "export default { title: 'Card' };\nexport const A = {};\n",
      "ui/Chip.stories.ts": "const meta = { component: Tag } as const;\nexport default meta;\nexport const A = {};\n",
    });
    const map = await findStories(root, "ui");
    expect([...map.entries()]).toEqual([
      ["Button", "ui/Button.stories.tsx"],
      ["Card", "ui/Card.stories.tsx"],
      ["Tag", "ui/Chip.stories.ts"],
    ]);
  });

  it("첫 named export 소스, 20줄 초과는 잘라 // … 를 붙인다", () => {
    expect(storyExample(BUTTON_STORIES, "a.stories.tsx")).toBe('export const Primary: Story = { args: { children: "저장" } };');
    const long = `export default {};\nexport const Big = {\n${Array.from({ length: 23 }, (_, i) => `  k${i}: ${i},`).join("\n")}\n};\n`;
    const out = storyExample(long, "a.stories.tsx") as string;
    const lines = out.split("\n");
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe("export const Big = {");
    expect(lines[20]).toBe("// …");
  });

  it("export type Story·interface는 첫 스토리로 치지 않는다", () => {
    const code = `const meta = {};\nexport default meta;\nexport type Story = StoryObj<typeof meta>;\nexport interface X {}\nexport const Real: Story = {};\n`;
    expect(storyExample(code, "a.stories.tsx")).toBe("export const Real: Story = {};");
  });

  it("별칭으로 import한 component는 원래 이름으로 매핑한다", async () => {
    const root = tmpTree({
      "ui/A.stories.tsx": "import { Button as UIButton } from './Button';\nexport default { component: UIButton };\nexport const S = {};\n",
    });
    expect([...(await findStories(root, "ui")).keys()]).toEqual(["Button"]);
  });

  it("named export가 없으면 null", () => {
    expect(storyExample("export default {};\n", "a.stories.tsx")).toBeNull();
  });
});
