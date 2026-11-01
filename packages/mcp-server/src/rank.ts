import type { Catalog, CatalogComponent, ComponentSummary } from "@dsmith-dev/core";
import type { Workspace } from "./workspace.js";

/** `decide --choose`로 정한 duplicate 항목의 module. 결정이 없으면 undefined. */
export function decidedModule(ws: Workspace, name: string): string | undefined {
  const record = ws.decisions.items.find((r) => r.item === name && r.kind === "duplicate" && r.status === "decided");
  return record?.chosen;
}

/** 카탈로그 항목이 이 module으로 불린다: 자기 module 또는 DS 배럴 별칭(modules[]) */
function moduleKeys(entry: CatalogComponent): string[] {
  return [entry.module, ...(entry.modules ?? [])];
}

const lookups = new WeakMap<Catalog, Map<string, CatalogComponent>>();

function lookupOf(catalog: Catalog): Map<string, CatalogComponent> {
  let map = lookups.get(catalog);
  if (map === undefined) {
    map = new Map();
    for (const entry of catalog.components) {
      for (const module of moduleKeys(entry)) {
        const key = `${entry.name}\0${module}`;
        if (!map.has(key)) map.set(key, entry);
      }
    }
    lookups.set(catalog, map);
  }
  return map;
}

/** name+module(배럴 별칭 포함)에 맞는 카탈로그 항목 */
export function catalogEntry(ws: Workspace, name: string, module: string): CatalogComponent | undefined {
  return ws.catalog === null ? undefined : lookupOf(ws.catalog).get(`${name}\0${module}`);
}

/** 인덱스 요약과 카탈로그 항목을 한 후보 목록으로 합친다. 같은 name+module(배럴 포함)이면 합치고, 인덱스에 없는 항목은 사용 0회 후보다. */
export function buildCandidates(components: ComponentSummary[], catalog: Catalog | null): ComponentSummary[] {
  if (catalog === null) return components;
  const lookup = lookupOf(catalog);
  const joined = new Set<CatalogComponent>();
  const merged = components.map((c) => {
    const entry = lookup.get(`${c.name}\0${c.module}`);
    if (entry === undefined) return c;
    joined.add(entry);
    const props = [...new Set([...c.props, ...entry.props.map((p) => p.name)])].sort();
    return { ...c, props };
  });
  for (const entry of catalog.components) {
    if (joined.has(entry)) continue;
    // 별칭 module 어느 쪽으로든 인덱스에 이미 있으면 합쳐진 것이다.
    if (moduleKeys(entry).some((m) => components.some((c) => c.name === entry.name && c.module === m))) continue;
    merged.push({
      name: entry.name,
      module: entry.module,
      importedFrom: entry.module,
      count: 0,
      files: [],
      props: entry.props.map((p) => p.name).sort(),
    });
  }
  return merged;
}

/**
 * 같은 근거로 줄 세울 때의 우선순위: 결정된 module → (DS module 또는 카탈로그에 있는 module) → (호출한 쪽의) 사용 수. 큰 값이 먼저.
 * isDs는 DS 패키지·경로 여부 그대로이고, inCatalog는 카탈로그에 실린 module인지다.
 */
export function precedence(ws: Workspace, name: string, module: string): { decided: boolean; isDs: boolean; inCatalog: boolean } {
  return { decided: decidedModule(ws, name) === module, isDs: ws.isDsModule(module), inCatalog: catalogEntry(ws, name, module) !== undefined };
}

/** 정렬 키: decided → DS 또는 카탈로그 */
export function standing(p: { decided: boolean; isDs: boolean; inCatalog: boolean }): [number, number] {
  return [Number(p.decided), Number(p.isDs || p.inCatalog)];
}
