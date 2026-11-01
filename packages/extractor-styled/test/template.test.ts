import { parseTsx } from "@dsmith-dev/core";
import type { TemplateLiteral } from "@babel/types";
import { describe, expect, it } from "vitest";
import { declarationsFromTemplate } from "../src/index.js";

/** `const A = styled.div\`…\`;`의 템플릿 리터럴. */
function templateOf(code: string): TemplateLiteral {
  const stmt = parseTsx(code, "a.tsx").program.body[0]!;
  if (stmt.type !== "VariableDeclaration") throw new Error("shape");
  const init = stmt.declarations[0]!.init;
  if (init?.type !== "TaggedTemplateExpression") throw new Error("shape");
  return init.quasi;
}

describe("declarationsFromTemplate 위치 매핑", () => {
  it("${} 5천 개 템플릿도 선형 시간에 가깝게, 원본 위치를 정확히 되돌린다", () => {
    const N = 5000;
    const lines: string[] = [];
    for (let i = 0; i < N; i++) lines.push(`  margin: \${m${i}}; padding: ${i}px; color: #fff; gap: 2px;`);
    const code = `const A = styled.div\`\n${lines.join("\n")}\n\`;`;
    const tpl = templateOf(code);

    const t = performance.now();
    const decls = declarationsFromTemplate(tpl, code);
    const elapsed = performance.now() - t;

    // 기대 위치는 소스 텍스트에서 독립적으로 계산한다: 각 줄의 값 문자열을 앞에서부터 차례로 찾는다.
    const expected: { property: string; slice: string; start: number }[] = [];
    let cursor = 0;
    const take = (property: string, text: string): void => {
      const start = code.indexOf(text, cursor);
      expected.push({ property, slice: text, start });
      cursor = start + text.length;
    };
    for (let i = 0; i < N; i++) {
      take("margin", `\${m${i}}`);
      take("padding", `${i}px`);
      take("color", "#fff");
      take("gap", "2px");
    }

    expect(decls).toHaveLength(expected.length);
    const actual = decls.map((d) => ({ property: d.property, slice: code.slice(d.codeStart, d.codeEnd), start: d.codeStart }));
    expect(actual).toEqual(expected);
    expect(decls.filter((d) => d.dynamic)).toHaveLength(N);
    expect(elapsed).toBeLessThan(300);
  });
});
