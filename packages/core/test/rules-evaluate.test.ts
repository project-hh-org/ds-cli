import { describe, expect, it } from "vitest";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import type { ComponentUsage } from "../src/model/component-usage.js";
import type { Token } from "../src/model/token.js";
import { normalizeColor } from "../src/normalize/color.js";
import { DEFAULT_GUARD_POLICY, type GuardPolicy, type RuleContext } from "../src/rules/model.js";
import { eligibleFindings, evaluateFile, findingKey, summarizeFindings } from "../src/rules/evaluate.js";

const color = (raw: string): StyleUsage["normalized"] => {
  const n = normalizeColor(raw);
  if (n === null) throw new Error(raw);
  return n;
};
const tokens: Token[] = [
  { name: "--color-blue", value: "#3b82f6", normalized: color("#3b82f6"), category: "color" },
  { name: "--space-4", value: "16px", normalized: { kind: "length", px: 16 }, category: "spacing" },
];
const usage = (over: Partial<StyleUsage>): StyleUsage => ({
  file: "src/a.tsx",
  line: 1,
  column: 0,
  property: "color",
  raw: "#3b82f6",
  normalized: color("#3b82f6"),
  source: "hardcoded",
  extractor: "inline-style",
  ...over,
});
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  tokens,
  ds: { modules: [], components: [] },
  preferred: [],
  policy: DEFAULT_GUARD_POLICY,
  ...over,
});
const run = (usages: StyleUsage[], components: ComponentUsage[] = [], over: Partial<RuleContext> = {}, file = "src/a.tsx") =>
  evaluateFile({ file, usages, components, ...ctx(over) });
const comp = (over: Partial<ComponentUsage>): ComponentUsage => ({ file: "src/a.tsx", line: 1, name: "Button", importedFrom: null, module: "", props: [], ...over });

describe("no-hardcoded-style", () => {
  it("exact 제안", () => {
    const [f] = run([usage({})]);
    expect(f?.rule).toBe("no-hardcoded-style");
    expect(f?.style?.replacement).toEqual({ token: "--color-blue", value: "#3b82f6", confidence: "exact", tokenIndex: 0 });
    expect(f?.message).toBe("하드코딩 color #3b82f6 — 토큰 --color-blue(#3b82f6) 사용");
    expect(f?.usageIndex).toBe(0);
    expect(f?.style?.category).toBe("color");
  });
  it("close 제안, far는 제안 없음", () => {
    const close = run([usage({ property: "padding", raw: "17px", normalized: { kind: "length", px: 17 } })]);
    expect(close[0]?.style?.replacement?.confidence).toBe("close");
    const far = run([usage({ property: "padding", raw: "40px", normalized: { kind: "length", px: 40 } })]);
    expect(far[0]?.style?.replacement).toBeNull();
    expect(far[0]?.message).toBe("하드코딩 padding 40px — 가까운 토큰 없음");
  });
  it("width 포함, 토큰·dynamic·tailwind-default·other·unknown은 제외", () => {
    const fs = run([
      usage({ property: "width", raw: "8px", normalized: { kind: "length", px: 8 } }),
      usage({ source: "token", line: 2 }),
      usage({ source: "dynamic", line: 3 }),
      usage({ source: "tailwind-default", line: 4 }),
      usage({ property: "other", line: 5 }),
      usage({ property: "width", raw: "calc(1px)", normalized: { kind: "unknown" }, line: 6 }),
    ]);
    expect(fs.map((f) => f.style?.property)).toEqual(["width"]);
  });
  it("allow.properties / allow.files / minConfidence", () => {
    const policy = (p: Partial<GuardPolicy>): GuardPolicy => ({ ...DEFAULT_GUARD_POLICY, ...p });
    expect(run([usage({ property: "width", raw: "8px", normalized: { kind: "length", px: 8 } })], [], { policy: policy({ allow: { files: [], properties: ["width"] } }) })).toEqual([]);
    expect(run([usage({})], [], { policy: policy({ allow: { files: ["**/legacy/**"], properties: [] } }) }, "src/legacy/a.tsx")).toEqual([]);
    expect(run([usage({})], [], { policy: policy({ allow: { files: ["**/legacy/**"], properties: [] } }) })).toHaveLength(1);
    const exactOnly = run([usage({ property: "padding", raw: "17px", normalized: { kind: "length", px: 17 } })], [], { policy: policy({ minConfidence: "exact" }) });
    expect(exactOnly[0]?.style?.replacement).toBeNull();
  });
  it("line → column → rule 정렬", () => {
    const fs = run([usage({ line: 3 }), usage({ line: 1, column: 5 }), usage({ line: 1, column: 2 })]);
    expect(fs.map((f) => [f.line, f.column])).toEqual([[1, 2], [1, 5], [3, 0]]);
  });
});

describe("components", () => {
  const ds = { modules: ["src/components/ui/button"], components: [{ name: "Button", module: "src/components/ui/button" }, { name: "Old", module: "src/components/ui/old", deprecated: "쓰지 마세요\n자세히" }] };
  it("DS module 사용은 통과", () => {
    expect(run([], [comp({ module: "src/components/ui/button", importedFrom: "src/components/ui/button" })], { ds })).toEqual([]);
  });
  it("DS 이름의 지역 선언과 import 없음, 다른 모듈은 prefer-ds-component", () => {
    const fs = run([], [comp({ declaredLocally: true }), comp({ line: 2, module: "src/legacy/Button", importedFrom: "src/legacy/Button" })], { ds });
    expect(fs.map((f) => [f.rule, f.component?.preferModule])).toEqual([
      ["prefer-ds-component", "src/components/ui/button"],
      ["prefer-ds-component", "src/components/ui/button"],
    ]);
    expect(fs[0]?.message).toBe("Button은 DS 컴포넌트(src/components/ui/button)를 쓰세요");
  });
  it("골격(scaffold) 항목은 권하지 않는다", () => {
    const scaffold = { modules: ["design-system/components/Btn"], components: [{ name: "Btn", module: "design-system/components/Btn", status: "scaffold" as const }] };
    expect(run([], [comp({ name: "Btn", module: "src/legacy/Btn" })], { ds: scaffold })).toEqual([]);
    expect(run([], [comp({ name: "Btn", module: "design-system/components/Btn" })], { ds: scaffold })).toEqual([]);
  });
  it("import 없고 지역 선언도 아닌 <Icon />은 무시", () => {
    expect(run([], [comp({ module: "" })], { ds })).toEqual([]);
  });
  it("DS에 없는 이름은 무시", () => {
    expect(run([], [comp({ name: "Card", module: "x" })], { ds })).toEqual([]);
  });
  it("decided duplicate: preferred module과 다르면 위반, 같으면 준수", () => {
    const preferred = [{ name: "Modal", module: "src/ui/modal" }];
    expect(run([], [comp({ name: "Modal", module: "src/old/modal" })], { preferred })).toHaveLength(1);
    expect(run([], [comp({ name: "Modal", module: "src/ui/modal" })], { preferred })).toEqual([]);
  });
  it("별칭·namespace로 import해도 imported 이름으로 대조한다(finding.component.name은 태그 그대로)", () => {
    const [dep, pref] = run(
      [],
      [
        comp({ name: "O", imported: "Old", module: "src/components/ui/old" }),
        comp({ line: 2, name: "LegacyBtn", imported: "Button", module: "src/legacy/Button" }),
        comp({ line: 3, name: "UI.Old", imported: "Old", module: "src/components/ui/old" }),
        comp({ line: 4, name: "Old", imported: "Other", module: "src/components/ui/old" }),
      ],
      { ds },
    );
    expect([dep?.rule, dep?.message, dep?.component?.name]).toEqual(["no-deprecated-component", "Old은 deprecated: 쓰지 마세요", "O"]);
    expect([pref?.rule, pref?.message, pref?.component?.name]).toEqual(["prefer-ds-component", "Button은 DS 컴포넌트(src/components/ui/button)를 쓰세요", "LegacyBtn"]);
    const all = run([], [comp({ line: 3, name: "UI.Old", imported: "Old", module: "src/components/ui/old" })], { ds });
    expect(all.map((f) => f.rule)).toEqual(["no-deprecated-component"]);
  });
  it("deprecated", () => {
    const [f] = run([], [comp({ name: "Old", module: "src/components/ui/old" })], { ds });
    expect(f?.rule).toBe("no-deprecated-component");
    expect(f?.message).toBe("Old은 deprecated: 쓰지 마세요");
    expect(f?.component?.deprecated).toContain("자세히");
  });
});

describe("치환 대상 플래그", () => {
  const px = (n: number): StyleUsage["normalized"] => ({ kind: "length", px: n });
  const t8: Token = { name: "--space-2", value: "8px", normalized: px(8), category: "spacing" };
  it("padding 0은 eligible false, 메시지 치환 대상 아님", () => {
    const [f] = run([usage({ property: "padding", raw: "0", normalized: px(0) })], [], { tokens: [{ ...t8, name: "--space-0", value: "0px", normalized: px(0) }] });
    expect(f?.style?.eligible).toBe(false);
    expect(f?.style?.replacement).toBeNull();
    expect(f?.message).toBe("하드코딩 padding 0 — 토큰 치환 대상 아님");
  });
  it("width 8은 8px 토큰이 있어도 eligible false", () => {
    const [f] = run([usage({ property: "width", raw: "8px", normalized: px(8) })], [], { tokens: [t8] });
    expect(f?.style?.eligible).toBe(false);
    expect(f?.style?.replacement).toBeNull();
    expect(f?.message).toContain("토큰 치환 대상 아님");
  });
  it("padding 8은 eligible, tokenIndex가 입력 위치", () => {
    const [f] = run([usage({ property: "padding", raw: "8px", normalized: px(8) })], [], { tokens: [tokens[0] as Token, t8] });
    expect(f?.style?.eligible).toBe(true);
    expect(f?.style?.replacement?.tokenIndex).toBe(1);
  });
  it("eligibleFindings는 대상 아닌 style만 뺀다", () => {
    const fs = run([usage({}), usage({ property: "width", raw: "8px", normalized: px(8), line: 2 })], [comp({ declaredLocally: true, line: 3 })], { ds: { modules: [], components: [{ name: "Button", module: "m" }] } });
    expect(fs).toHaveLength(3);
    expect(eligibleFindings(fs).map((f) => f.rule)).toEqual(["no-hardcoded-style", "prefer-ds-component"]);
  });
});

describe("findingKey / summarizeFindings", () => {
  it("findingKey는 줄 번호에 무관", () => {
    const a = run([usage({ line: 1 })])[0];
    const b = run([usage({ line: 40 })])[0];
    expect(a && b && findingKey(a)).toBe(b && findingKey(b));
    expect(a && findingKey(a)).toBe("no-hardcoded-style|color|#3b82f6");
  });
  it("summarize", () => {
    const fs = run(
      [usage({}), usage({ property: "padding", raw: "40px", normalized: { kind: "length", px: 40 }, line: 2 })],
      [comp({ declaredLocally: true, line: 3 })],
      { ds: { modules: [], components: [{ name: "Button", module: "m" }] } },
    );
    expect(summarizeFindings(fs)).toEqual({ hardcoded: 2, replaceable: 1, nonDs: 1, deprecated: 0 });
  });
});
