import type { ComponentUsage } from "../model/component-usage.js";

export interface ComponentSummary {
  name: string;
  /** "" = import 없는 지역 사용 */
  module: string;
  /** 그룹에서 처음 본 값 */
  importedFrom: string | null;
  count: number;
  /** count 내림차순, 같으면 file 오름차순 */
  files: { file: string; count: number }[];
  /** 사용처 props의 합집합, 오름차순 */
  props: string[];
}

const DEFAULT_LOCAL_DEFINITION_LIMIT = 20;

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * name+module로 묶는다. 서브패스·별칭이 달라도 같은 모듈이면 한 그룹이다.
 * importedFrom은 처음 본 값을 남긴다(결과 JSON 호환).
 * 정렬: count 내림차순 → name → importedFrom → module.
 */
export function summarizeComponents(usages: ComponentUsage[]): ComponentSummary[] {
  interface Acc {
    name: string;
    module: string;
    importedFrom: string | null;
    count: number;
    files: Map<string, number>;
    props: Set<string>;
  }
  const groups = new Map<string, Acc>();
  for (const c of usages) {
    const key = JSON.stringify([c.name, c.module]);
    let g = groups.get(key);
    if (!g) {
      g = { name: c.name, module: c.module, importedFrom: c.importedFrom, count: 0, files: new Map(), props: new Set() };
      groups.set(key, g);
    }
    g.count += 1;
    g.files.set(c.file, (g.files.get(c.file) ?? 0) + 1);
    for (const p of c.props) g.props.add(p);
  }
  return [...groups.values()]
    .map(
      (g): ComponentSummary => ({
        name: g.name,
        module: g.module,
        importedFrom: g.importedFrom,
        count: g.count,
        files: [...g.files.entries()]
          .map(([file, count]) => ({ file, count }))
          .sort((a, b) => b.count - a.count || byCodeUnit(a.file, b.file)),
        props: [...g.props].sort(byCodeUnit),
      }),
    )
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.name.localeCompare(b.name) ||
        (a.importedFrom ?? "").localeCompare(b.importedFrom ?? "") ||
        a.module.localeCompare(b.module),
    );
}

/**
 * 같은 이름이 둘 이상의 module에서 오는 컴포넌트 이름을 사용 수 내림차순으로 모은다.
 * import 없는 지역 사용(module "")은 출처로 세지 않는다 — 그건 localDefinitionsOf가 따로 보고한다.
 */
export function duplicateNames(summaries: ComponentSummary[]): string[] {
  const byName = new Map<string, { modules: Set<string>; total: number }>();
  for (const c of summaries) {
    const entry = byName.get(c.name) ?? { modules: new Set<string>(), total: 0 };
    if (c.module !== "") entry.modules.add(c.module);
    entry.total += c.count;
    byName.set(c.name, entry);
  }
  return [...byName.entries()]
    .filter(([, e]) => e.modules.size >= 2)
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

export interface LocalDefinition {
  name: string;
  files: number;
}

/**
 * import 없이 쓰고 그 파일 최상위에 선언도 있는(declaredLocally) 이름 중 둘 이상의 파일에 있는 것.
 * props·지역 변수로 받은 컴포넌트는 정의가 아니므로 세지 않는다. 파일 수 내림차순, 같으면 이름순, 상위 limit개.
 */
export function localDefinitionsOf(usages: ComponentUsage[], limit: number = DEFAULT_LOCAL_DEFINITION_LIMIT): LocalDefinition[] {
  const filesByName = new Map<string, Set<string>>();
  for (const c of usages) {
    if (c.importedFrom !== null || c.declaredLocally !== true) continue;
    const files = filesByName.get(c.name) ?? new Set<string>();
    files.add(c.file);
    filesByName.set(c.name, files);
  }
  return [...filesByName.entries()]
    .map(([name, files]) => ({ name, files: files.size }))
    .filter((d) => d.files >= 2)
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** name을 import 없이 쓰면서 최상위에 선언한(declaredLocally) 파일, 오름차순 */
export function localDefinitionFiles(usages: ComponentUsage[], name: string): string[] {
  const files = new Set<string>();
  for (const c of usages) {
    if (c.name === name && c.importedFrom === null && c.declaredLocally === true) files.add(c.file);
  }
  return [...files].sort(byCodeUnit);
}
