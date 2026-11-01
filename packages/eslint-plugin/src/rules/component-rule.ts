import type { Rule } from "eslint";
import type { RuleId } from "@dsmith-dev/core";
import { analyze, withStaleNotice } from "../analyze.js";

interface OpeningLike {
  name: unknown;
  loc?: Rule.Node["loc"];
}

/**
 * 컴포넌트 finding은 column이 0이라(줄만 안다) 그 줄의 같은 이름 JSX 여는 태그에 보고한다.
 * 노드를 못 찾으면 { line, column: 0 }.
 */
export function componentRule(ruleId: RuleId, description: string): Rule.RuleModule {
  return {
    meta: {
      type: "suggestion",
      docs: { description },
      schema: [],
      messages: { finding: "{{message}}" },
    },
    create(context) {
      const openings = new Map<number, Rule.Node[]>();
      const sourceCode = context.sourceCode;
      return {
        JSXOpeningElement(node: Rule.Node) {
          const line = node.loc?.start.line;
          if (line === undefined) return;
          const list = openings.get(line) ?? [];
          list.push(node);
          openings.set(line, list);
        },
        "Program:exit"() {
          const a = analyze(context);
          if (a === null) return;
          for (const f of a.componentFindings) {
            if (f.rule !== ruleId || f.component === undefined) continue;
            const name = f.component.name;
            const list = openings.get(f.line) ?? [];
            const textOf = (n: Rule.Node): string => sourceCode.getText((n as unknown as OpeningLike).name as Rule.Node);
            // 같은 줄에 `Button`과 `Button.Group`이 함께 있으면 정확히 같은 태그를 먼저 고른다.
            let at = list.findIndex((n) => textOf(n) === name);
            if (at < 0) at = list.findIndex((n) => textOf(n).startsWith(`${name}.`));
            const node = at >= 0 ? list.splice(at, 1)[0] : undefined;
            const data = { message: withStaleNotice(a, f.message) };
            if (node !== undefined) context.report({ node, messageId: "finding", data });
            else context.report({ loc: { line: f.line, column: 0 }, messageId: "finding", data });
          }
        },
      };
    },
  };
}
