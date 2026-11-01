import picomatch from "picomatch";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import type { ComponentUsage } from "../model/component-usage.js";
import { isRatedUsage } from "../model/style-usage.js";
import { bestReplacement } from "../tokens/draft.js";
import { tokenCategoryOf } from "../tokens/load.js";
import type { DsComponentRef, Finding, RuleContext, RuleId } from "./model.js";

const RULE_ORDER: Record<RuleId, number> = { "no-hardcoded-style": 0, "prefer-ds-component": 1, "no-deprecated-component": 2 };
const DEPRECATED_MAX = 80;

function firstLine(text: string): string {
  const line = (text.split("\n")[0] ?? "").trim();
  return line.length > DEPRECATED_MAX ? line.slice(0, DEPRECATED_MAX) : line;
}

const modulesOf = (c: DsComponentRef): string[] => [c.module, ...(c.modules ?? [])];

function styleFindings(file: string, usages: StyleUsage[], ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  usages.forEach((u, usageIndex) => {
    if (!isRatedUsage(u) || u.source !== "hardcoded") return;
    if (ctx.policy.allow.properties.includes(u.property)) return;
    const best = bestReplacement(u, ctx.tokens);
    const replacement =
      best === null || (ctx.policy.minConfidence === "exact" && best.confidence !== "exact")
        ? null
        : { token: best.token.name, value: best.token.value, confidence: best.confidence };
    out.push({
      rule: "no-hardcoded-style",
      file,
      line: u.line,
      column: u.column,
      message:
        replacement === null
          ? `하드코딩 ${u.property} ${u.raw} — 가까운 토큰 없음`
          : `하드코딩 ${u.property} ${u.raw} — 토큰 ${replacement.token}(${replacement.value}) 사용`,
      usageIndex,
      style: { property: u.property, raw: u.raw, extractor: u.extractor, category: tokenCategoryOf(u.property), replacement },
    });
  });
  return out;
}

function componentFindings(file: string, components: ComponentUsage[], ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  for (const c of components) {
    const sameName = ctx.ds.components.filter((d) => d.name === c.name);

    // deprecated: 이름·module이 DS 컴포넌트와 같다
    if (c.module !== "") {
      const dep = sameName.find((d) => d.deprecated !== undefined && modulesOf(d).includes(c.module));
      if (dep?.deprecated !== undefined) {
        out.push({
          rule: "no-deprecated-component",
          file,
          line: c.line,
          column: 0,
          message: `${c.name}은 deprecated: ${firstLine(dep.deprecated)}`,
          component: { name: c.name, module: c.module, deprecated: dep.deprecated },
        });
      }
    }

    // prefer-ds-component
    let preferModule: string | null = null;
    const prefs = ctx.preferred.filter((p) => p.name === c.name);
    if (prefs.length > 0 && c.module !== "" && !prefs.some((p) => p.module === c.module)) {
      preferModule = prefs[0]?.module ?? null;
    } else if (prefs.length === 0 || c.module === "") {
      const first = sameName[0];
      if (first !== undefined && !ctx.ds.modules.includes(c.module) && !sameName.some((d) => modulesOf(d).includes(c.module))) {
        preferModule = first.module;
      }
    }
    if (preferModule !== null) {
      out.push({
        rule: "prefer-ds-component",
        file,
        line: c.line,
        column: 0,
        message: `${c.name}은 DS 컴포넌트(${preferModule})를 쓰세요`,
        component: { name: c.name, module: c.module, preferModule },
      });
    }
  }
  return out;
}

/** 순수 규칙 엔진. 정렬: line → column → rule. */
export function evaluateFile(input: { file: string; usages: StyleUsage[]; components: ComponentUsage[] } & RuleContext): Finding[] {
  const { file, usages, components, ...ctx } = input;
  if (ctx.policy.allow.files.length > 0 && picomatch(ctx.policy.allow.files, { dot: true })(file)) return [];
  const all = [...styleFindings(file, usages, ctx), ...componentFindings(file, components, ctx)];
  return all.sort((a, b) => a.line - b.line || a.column - b.column || RULE_ORDER[a.rule] - RULE_ORDER[b.rule]);
}

/** 줄 이동에 강한 비교 키 */
export function findingKey(f: Finding): string {
  if (f.style !== undefined) return `${f.rule}|${f.style.property}|${f.style.raw}`;
  return `${f.rule}|${f.component?.name ?? ""}|${f.component?.module ?? ""}`;
}

export function summarizeFindings(fs: Finding[]): { hardcoded: number; replaceable: number; nonDs: number; deprecated: number } {
  const s = { hardcoded: 0, replaceable: 0, nonDs: 0, deprecated: 0 };
  for (const f of fs) {
    if (f.rule === "no-hardcoded-style") {
      s.hardcoded += 1;
      if (f.style?.replacement != null) s.replaceable += 1;
    } else if (f.rule === "prefer-ds-component") s.nonDs += 1;
    else s.deprecated += 1;
  }
  return s;
}
