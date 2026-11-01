import type { TokenDraft } from "./draft.js";

export const GENERATED_NOTICE =
  "dsmith init이 생성한 파일입니다. 직접 고치면 다음 init이 덮어쓰지 않습니다(--force로 덮어씀).";

const GROUPS = ["color", "space", "radius", "text"] as const;

/** `:root { --color-gray-50: #ffffff; … }` — draft 순서 그대로 */
export function emitTokensCss(draft: TokenDraft): string {
  const lines = draft.tokens.map((t) => `  --${t.name}: ${t.value};`);
  return `/* ${GENERATED_NOTICE} */\n:root {\n${lines.join("\n")}\n}\n`;
}

/** `export const tokens = { … } as const;` — 그룹 순서 color → space → radius → text, 빈 그룹 생략 */
export function emitTokensTs(draft: TokenDraft): string {
  const blocks: string[] = [];
  for (const group of GROUPS) {
    const entries = draft.tokens.filter((t) => t.group === group);
    if (entries.length === 0) continue;
    const lines = entries.map((t) => `    ${JSON.stringify(t.key)}: ${JSON.stringify(t.value)},`);
    blocks.push(`  ${group}: {\n${lines.join("\n")}\n  },`);
  }
  return (
    `// ${GENERATED_NOTICE}\nexport const tokens = {\n${blocks.join("\n")}\n} as const;\n\n` +
    `export type Tokens = typeof tokens;\n`
  );
}
