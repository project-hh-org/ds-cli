import picomatch from "picomatch";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import type { ComponentUsage } from "../model/component-usage.js";
import { isRatedUsage } from "../model/style-usage.js";
import { tokenCategoryOf } from "../tokens/category.js";
import { COVERAGE_PROPERTIES, bestReplacement } from "../tokens/draft.js";
import type { DsComponentRef, Finding, RuleContext, RuleId } from "./model.js";

const RULE_ORDER: Record<RuleId, number> = { "no-hardcoded-style": 0, "prefer-ds-component": 1, "no-deprecated-component": 2 };
const DEPRECATED_MAX = 80;

function firstLine(text: string): string {
  const line = (text.split("\n")[0] ?? "").trim();
  return line.length > DEPRECATED_MAX ? line.slice(0, DEPRECATED_MAX) : line;
}

const modulesOf = (c: DsComponentRef): string[] => [c.module, ...(c.modules ?? [])];

const globCache = new WeakMap<readonly string[], (file: string) => boolean>();
function allowedFile(globs: readonly string[], file: string): boolean {
  if (globs.length === 0) return false;
  let m = globCache.get(globs);
  if (m === undefined) {
    m = picomatch([...globs], { dot: true });
    globCache.set(globs, m);
  }
  return m(file);
}

function styleFindings(file: string, usages: StyleUsage[], ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  usages.forEach((u, usageIndex) => {
    if (!isRatedUsage(u) || u.source !== "hardcoded") return;
    if (ctx.policy.allow.properties.includes(u.property)) return;
    const category = tokenCategoryOf(u.property);
    const eligible = COVERAGE_PROPERTIES.includes(u.property) && !(category === "spacing" && u.normalized.kind === "length" && u.normalized.px <= 0);
    const best = eligible ? bestReplacement(u, ctx.tokens) : null;
    const replacement =
      best === null || (ctx.policy.minConfidence === "exact" && best.confidence !== "exact")
        ? null
        : { token: best.token.name, value: best.token.value, confidence: best.confidence, tokenIndex: ctx.tokens.indexOf(best.token) };
    out.push({
      rule: "no-hardcoded-style",
      file,
      line: u.line,
      column: u.column,
      message: !eligible
        ? `하드코딩 ${u.property} ${u.raw} — 토큰 치환 대상 아님`
        : replacement === null
          ? `하드코딩 ${u.property} ${u.raw} — 가까운 토큰 없음`
          : `하드코딩 ${u.property} ${u.raw} — 토큰 ${replacement.token}(${replacement.value}) 사용`,
      usageIndex,
      style: { property: u.property, raw: u.raw, extractor: u.extractor, category, eligible, replacement },
    });
  });
  return out;
}

function componentFindings(file: string, components: ComponentUsage[], ctx: RuleContext): Finding[] {
  const out: Finding[] = [];
  for (const c of components) {
    const dsName = c.imported ?? c.name;
    const sameName = ctx.ds.components.filter((d) => d.name === dsName);

    // deprecated: 이름·module이 DS 컴포넌트와 같다
    if (c.module !== "") {
      const dep = sameName.find((d) => d.deprecated !== undefined && modulesOf(d).includes(c.module));
      if (dep?.deprecated !== undefined) {
        out.push({
          rule: "no-deprecated-component",
          file,
          line: c.line,
          column: 0,
          message: `${dsName}은 deprecated: ${firstLine(dep.deprecated)}`,
          component: { name: c.name, module: c.module, deprecated: dep.deprecated },
        });
      }
    }

    // prefer-ds-component
    let preferModule: string | null = null;
    const prefs = ctx.preferred.filter((p) => p.name === dsName);
    // module ""(import 없음)은 이 파일에 선언한 컴포넌트일 때만 대상 — props·변수로 받은 <Icon />은 제외
    const importless = c.module === "";
    if (prefs.length > 0 && !importless && !prefs.some((p) => p.module === c.module)) {
      preferModule = prefs[0]?.module ?? null;
    } else if ((prefs.length === 0 || importless) && (!importless || c.declaredLocally === true)) {
      const first = sameName.find((d) => d.status !== "scaffold");
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
        message: `${dsName}은 DS 컴포넌트(${preferModule})를 쓰세요`,
        component: { name: c.name, module: c.module, preferModule },
      });
    }
  }
  return out;
}

/** 순수 규칙 엔진. file은 root 상대 POSIX 경로여야 한다(allow.files glob이 그 모양을 가정). 정렬: line → column → rule. */
export function evaluateFile(input: { file: string; usages: StyleUsage[]; components: ComponentUsage[] } & RuleContext): Finding[] {
  const { file, usages, components, ...ctx } = input;
  if (allowedFile(ctx.policy.allow.files, file)) return [];
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

/** 토큰 치환 대상이 아닌 스타일 finding(width·height, 간격 0 등)을 뺀다. ESLint·guard --ci용 */
export function eligibleFindings(fs: Finding[]): Finding[] {
  return fs.filter((f) => f.style === undefined || f.style.eligible);
}
