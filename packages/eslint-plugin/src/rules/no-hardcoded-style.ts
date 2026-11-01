import type { Rule } from "eslint";
import { eligibleFindings, type Finding } from "@dsmith-dev/core";
import { analyze, withStaleNotice, type Analysis } from "../analyze.js";
import { BUILTIN_EXTRACTORS } from "../registry.js";

interface Options {
  reportIneligible?: boolean;
}

interface Fixable {
  start: number;
  end: number;
  replacement: string;
  token: string;
  confidence: "exact" | "close";
}

/** finding의 원 usage를 같은 Extractor의 tokenRef·write로 치환 구간으로 바꾼다. 참조 형식이 없으면 null */
function fixOf(a: Analysis, f: Finding): Fixable | null {
  const replacement = f.style?.replacement;
  if (f.usageIndex === undefined || replacement == null) return null;
  const usage = a.usages[f.usageIndex];
  const token = a.snapshot.tokens[replacement.tokenIndex];
  if (usage === undefined || token === undefined) return null;
  const extractor = Object.hasOwn(BUILTIN_EXTRACTORS, usage.extractor) ? BUILTIN_EXTRACTORS[usage.extractor] : undefined;
  if (extractor?.tokenRef === undefined) return null;
  const preset = a.snapshot.preset;
  const ref = extractor.tokenRef(token, usage, preset?.linked === true ? { preset } : {});
  if (ref === null) return null;
  const patch = extractor.write(usage, ref);
  if (patch === null) return null;
  return { start: patch.start, end: patch.end, replacement: patch.replacement, token: replacement.token, confidence: replacement.confidence };
}

export const noHardcodedStyle: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow hardcoded style values that have a design token" },
    fixable: "code",
    hasSuggestions: true,
    schema: [
      {
        type: "object",
        properties: { reportIneligible: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      finding: "{{message}}",
      replace: "{{token}}로 바꾸기",
      replaceStale: "{{token}}로 바꾸기 (guard.json이 낡아 자동 수정하지 않음 — 토큰이 바뀌었는지 확인)",
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options;
    const sourceCode = context.sourceCode;
    return {
      Program() {
        const a = analyze(context);
        if (a === null) return;
        const findings = a.styleFindings.filter((f) => f.rule === "no-hardcoded-style");
        const stale = a.stale.length > 0;
        for (const f of options.reportIneligible === true ? findings : eligibleFindings(findings)) {
          const data = { message: withStaleNotice(a, f.message) };
          const fix = fixOf(a, f);
          if (fix === null) {
            context.report({ loc: { line: f.line, column: f.column }, messageId: "finding", data });
            continue;
          }
          const loc = { start: sourceCode.getLocFromIndex(fix.start), end: sourceCode.getLocFromIndex(fix.end) };
          const edit = (fixer: Rule.RuleFixer): Rule.Fix => fixer.replaceTextRange([fix.start, fix.end], fix.replacement);
          // 스냅샷이 낡았으면 토큰이 바뀌었거나 없어졌을 수 있다 — exact여도 자동 수정(--fix) 대신 제안으로만 낸다.
          if (fix.confidence === "exact" && !stale) context.report({ loc, messageId: "finding", data, fix: edit });
          else context.report({ loc, messageId: "finding", data, suggest: [{ messageId: stale ? "replaceStale" : "replace", data: { token: fix.token }, fix: edit }] });
        }
      },
    };
  },
};
