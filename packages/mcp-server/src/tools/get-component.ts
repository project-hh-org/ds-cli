import fs from "node:fs/promises";
import path from "node:path";
import { readComponentProps, resolveDefinitionFile, type ComponentSummary, type PropInfo } from "@dsmith-dev/core";
import { precedence } from "../rank.js";
import type { Workspace } from "../workspace.js";

export interface GetComponentInput {
  name: string;
  module?: string | undefined;
}

export interface OtherModule {
  module: string;
  /** DS 패키지·경로에서 오는 module인가 */
  isDs: boolean;
  /** `decide --choose`로 이 module을 고른 상태인가 */
  decided: boolean;
}

/** 없는 이름. similar = 대소문자 무시 부분 일치 또는 편집 거리 ≤ 2인 이름 */
export interface ComponentNotFound {
  error: "not-found";
  message: string;
  similar: string[];
}

export interface GetComponentOutput {
  name: string;
  module: string;
  /** DS 패키지·경로에서 오는 module인가 */
  isDs: boolean;
  /** `decide --choose`로 이 module을 고른 상태인가 */
  decided: boolean;
  props: PropInfo[];
  /** 정의 파일의 TS 타입에서 읽었으면 "type", 아니면 사용처 props 이름만 "usage" */
  propsSource: "type" | "usage";
  inherits?: string[];
  /** props 중 `variant`의 values */
  variants?: string[];
  usage: { count: number; files: string[] };
  definitionFile?: string;
  /** 같은 이름의 다른 module (module을 지정하지 않았을 때). 순서는 고른 module과 같은 기준(결정 → DS → 사용 수) */
  otherModules?: OtherModule[];
  /** 3a는 항상 "index" — 카탈로그(3b)가 없다 */
  source: "index" | "catalog";
}

const SIMILAR_LIMIT = 5;
const USAGE_FILES = 5;
const MAX_TYPO_DISTANCE = 2;

/**
 * 정의 파일을 풀어 볼 만한 module인가. 패키지 이름(`next`, `lib`, `@scope/pkg`)은 레포 안 경로와 구분할 수 없어 제외한다.
 * 인덱서가 만드는 경로 module은 항상 root 상대 경로(`/` 포함)다.
 */
function isPathModule(module: string): boolean {
  return module.includes("/") && !module.startsWith("@");
}

/** 편집 거리(삽입·삭제·치환 각 1). 이름 길이가 짧아 O(nm)로 충분하다. */
export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** 대소문자 무시 부분 문자열 포함이거나 편집 거리 ≤ 2인 컴포넌트 이름(최대 5개). `Buton` → `Button`. */
function similarNames(ws: Workspace, name: string): string[] {
  const needle = name.toLowerCase();
  const found = new Set<string>();
  for (const c of ws.components) {
    const lower = c.name.toLowerCase();
    if (lower.includes(needle) || needle.includes(lower) || levenshtein(lower, needle) <= MAX_TYPO_DISTANCE) found.add(c.name);
  }
  return [...found].slice(0, SIMILAR_LIMIT);
}

/** 결정된 module → DS module → 사용 수(입력 순서 유지) */
function rank(ws: Workspace, candidates: ComponentSummary[]): ComponentSummary[] {
  const flags = new Map(candidates.map((c) => [c, precedence(ws, c.name, c.module)] as const));
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const fa = flags.get(a.c);
      const fb = flags.get(b.c);
      return Number(fb?.decided) - Number(fa?.decided) || Number(fb?.isDs) - Number(fa?.isDs) || b.c.count - a.c.count || a.i - b.i;
    })
    .map((x) => x.c);
}

/**
 * name(+module) 일치 요약 중 결정된 module → DS module → 사용 수 순으로 첫 번째의 props·정의 파일·사용 현황.
 * import 출처가 있는 것(module ≠ "")이 지역 사용보다 먼저다.
 */
export async function getComponent(ws: Workspace, input: GetComponentInput): Promise<GetComponentOutput | ComponentNotFound> {
  const matches = ws.components.filter((c) => c.name === input.name && (input.module === undefined || c.module === input.module));
  const imported = matches.filter((c) => c.module !== "");
  const ranked = rank(ws, imported.length > 0 ? imported : matches);
  const chosen: ComponentSummary | undefined = ranked[0];
  if (chosen === undefined) {
    const similar = similarNames(ws, input.name);
    return { error: "not-found", message: `컴포넌트 없음: ${input.name}${similar.length > 0 ? `. 비슷한 이름: ${similar.join(", ")}` : ""}`, similar };
  }

  let props: PropInfo[] = chosen.props.map((name) => ({ name }));
  let propsSource: GetComponentOutput["propsSource"] = "usage";
  let inherits: string[] = [];
  const definitionFile = isPathModule(chosen.module) ? await resolveDefinitionFile(ws.root, chosen.module) : null;
  if (definitionFile !== null) {
    const code = await fs.readFile(path.resolve(ws.root, definitionFile), "utf8").catch(() => null);
    const read = code === null ? null : readComponentProps(code, definitionFile, chosen.name);
    if (read !== null) {
      props = read.props;
      propsSource = "type";
      inherits = read.inherits;
    }
  }

  const variants = props.find((p) => p.name === "variant")?.values;
  const otherModules: OtherModule[] =
    input.module === undefined
      ? [...new Set(ranked.filter((c) => c !== chosen && c.module !== "").map((c) => c.module))].map((module) => ({
          module,
          ...precedence(ws, chosen.name, module),
        }))
      : [];
  const self = precedence(ws, chosen.name, chosen.module);
  return {
    name: chosen.name,
    module: chosen.module,
    isDs: self.isDs,
    decided: self.decided,
    props,
    propsSource,
    ...(inherits.length > 0 ? { inherits } : {}),
    ...(variants === undefined ? {} : { variants }),
    usage: { count: chosen.count, files: chosen.files.slice(0, USAGE_FILES).map((f) => f.file) },
    ...(definitionFile === null ? {} : { definitionFile }),
    ...(otherModules.length > 0 ? { otherModules } : {}),
    source: "index",
  };
}
