import fs from "node:fs/promises";
import path from "node:path";
import { readComponentProps, resolveDefinitionFile, type ComponentSummary, type PropInfo } from "@dsmith-dev/core";
import type { Workspace } from "../workspace.js";

export interface GetComponentInput {
  name: string;
  module?: string | undefined;
}

export interface GetComponentOutput {
  name: string;
  module: string;
  props: PropInfo[];
  /** 정의 파일의 TS 타입에서 읽었으면 "type", 아니면 사용처 props 이름만 "usage" */
  propsSource: "type" | "usage";
  inherits?: string[];
  /** props 중 `variant`의 values */
  variants?: string[];
  usage: { count: number; files: string[] };
  definitionFile?: string;
  /** 같은 이름의 다른 module (module을 지정하지 않았을 때) */
  otherModules?: string[];
  /** 3a는 항상 "index" — 카탈로그(3b)가 없다 */
  source: "index" | "catalog";
}

const SIMILAR_LIMIT = 5;
const USAGE_FILES = 5;

/**
 * 정의 파일을 풀어 볼 만한 module인가. 패키지 이름(`next`, `lib`, `@scope/pkg`)은 레포 안 경로와 구분할 수 없어 제외한다.
 * 인덱서가 만드는 경로 module은 항상 root 상대 경로(`/` 포함)다.
 */
function isPathModule(module: string): boolean {
  return module.includes("/") && !module.startsWith("@");
}

function similarNames(ws: Workspace, name: string): string[] {
  const needle = name.toLowerCase();
  const found = new Set<string>();
  for (const c of ws.components) {
    const lower = c.name.toLowerCase();
    if (lower.includes(needle) || needle.includes(lower)) found.add(c.name);
  }
  return [...found].slice(0, SIMILAR_LIMIT);
}

/** name(+module) 일치 요약 중 사용 수 최대(import 출처가 있는 것 우선)의 props·정의 파일·사용 현황 */
export async function getComponent(ws: Workspace, input: GetComponentInput): Promise<GetComponentOutput> {
  const matches = ws.components.filter((c) => c.name === input.name && (input.module === undefined || c.module === input.module));
  const chosen: ComponentSummary | undefined = matches.find((c) => c.module !== "") ?? matches[0];
  if (chosen === undefined) {
    const similar = similarNames(ws, input.name);
    throw new Error(`컴포넌트 없음: ${input.name}${similar.length > 0 ? `. 비슷한 이름: ${similar.join(", ")}` : ""}`);
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
  const others = input.module === undefined ? [...new Set(matches.filter((c) => c !== chosen && c.module !== "").map((c) => c.module))] : [];
  return {
    name: chosen.name,
    module: chosen.module,
    props,
    propsSource,
    ...(inherits.length > 0 ? { inherits } : {}),
    ...(variants === undefined ? {} : { variants }),
    usage: { count: chosen.count, files: chosen.files.slice(0, USAGE_FILES).map((f) => f.file) },
    ...(definitionFile === null ? {} : { definitionFile }),
    ...(others.length > 0 ? { otherModules: others } : {}),
    source: "index",
  };
}
