import fs from "node:fs/promises";
import path from "node:path";
import {
  listDecisions,
  moduleKeyOf,
  moduleOfFile,
  normalizePackageSpecifier,
  parseTsx,
  readCatalog,
  readComponentProps,
  readTsconfigPaths,
  resolveDefinitionFile,
  type DecisionKind,
  type DecisionsFile,
  type Index,
  type ModuleContext,
  type TextPatch,
  type TsPaths,
} from "@dsmith-dev/core";
import { readCvaVariants } from "./cva.js";
import { specifierForModule } from "./specifier.js";

export type ComponentSkipReason =
  | "decision-pending"
  | "mapping-missing"
  | "mapping-conflict"
  | "non-jsx-use"
  | "spread-props"
  | "export-unknown"
  | "overlap"
  | "rolled-back";

export interface ChosenTarget {
  item: string;
  kind: "duplicate" | "local-definition";
  /** duplicate: 고른 module, local-definition: moduleOfFile(고른 파일) */
  module: string;
  /** 정의 파일(root 상대) */
  file: string | null;
  /** 정의 파일 파싱: `export function|const|class X`·`export { X }` → named, 아니면 `export default` → default, 패키지 → named, 모름 → null */
  exportKind: "named" | "default" | null;
  /** 카탈로그 컴포넌트 props(있으면) → readComponentProps → 모르면 null */
  props: string[] | null;
  mapping: Record<string, string>;
  /** 결정 기록의 선택지(이 module들에서 온 import만 바꾼다) */
  options: string[];
  /** 대상이 상속하는 타입(예: ButtonHTMLAttributes). 비어 있지 않으면 네이티브 속성(onClick·disabled…)은 props에 없어도 통과시킨다 */
  inherits?: string[];
  /** inherits 중 DOM 속성 타입이 아니고 같은 파일에서 풀지도 못한 것(예: 정의를 찾지 못한 `VariantProps<typeof x>`). 있으면 props에 없는 prop은 확인할 수 없으니 mapping에 나온 것만 통과 */
  unknownInherits?: string[];
  /** prop → 허용하는 문자열 리터럴 값(유니온을 읽었을 때만) */
  propValues?: Record<string, string[]>;
}

export interface PlannedComponentEdit {
  item: string;
  kind: "import" | "prop" | "annotate";
  file: string;
  line: number;
  patch: TextPatch;
  detail: string;
  /** 같은 group의 편집은 전부 적용하거나 전부 보류한다(한 import 선언을 함께 쓰는 항목들은 한 group) */
  group: string;
}

export interface HeldComponentEdit {
  item: string;
  file: string;
  line: number;
  reason: ComponentSkipReason;
  detail: string;
}

export interface ComponentPlanSummary {
  /** 결정(duplicate·local-definition)이 끝나 치환 대상이 된 항목 수 */
  decided: number;
  /** 컴포넌트 편집이 있는 파일 수 */
  files: number;
  /** (파일, 항목) 단위 import 치환 수 */
  imports: number;
  /** 바뀐 prop(이름·값) 수 */
  props: number;
  /** 지역 정의에 붙인 주석 수 */
  annotations: number;
  /** 결정 대기(또는 stale) 항목 수 */
  pending: number;
  held: Partial<Record<ComponentSkipReason, number>>;
}

/** 편집 목록의 종류별 개수. imports는 (파일, 항목) 단위 */
export function countComponentEdits(edits: PlannedComponentEdit[]): { imports: number; props: number; annotations: number } {
  const imports = new Set<string>();
  let props = 0;
  let annotations = 0;
  for (const e of edits) {
    if (e.kind === "import") imports.add(`${e.file}\0${e.item}`);
    else if (e.kind === "prop") props += 1;
    else annotations += 1;
  }
  return { imports: imports.size, props, annotations };
}

// ───────────────────────── 환경 ─────────────────────────

const JS_FILE = /\.(?:[cm]?[jt]sx?)$/;

export interface ModuleEnv {
  tsPaths: TsPaths | null;
  moduleContext: ModuleContext;
}

/** 인덱서가 module 키를 만들 때 쓴 것과 같은 환경(tsconfig paths·baseUrl 항목·의존성)을 다시 모은다 */
export async function loadModuleEnv(root: string): Promise<ModuleEnv> {
  const tsPaths = await readTsconfigPaths(root);
  const baseUrlEntries = new Set<string>();
  if (tsPaths?.baseUrlExplicit === true) {
    try {
      for (const e of await fs.readdir(path.join(root, tsPaths.baseUrl), { withFileTypes: true })) {
        if (e.isDirectory()) baseUrlEntries.add(e.name);
        else if (e.isFile() && JS_FILE.test(e.name)) baseUrlEntries.add(e.name.replace(JS_FILE, ""));
      }
    } catch {
      // 읽지 못하면 빈 집합
    }
  }
  return { tsPaths, moduleContext: { baseUrlEntries, dependencies: await dependencyNames(root) } };
}

async function dependencyNames(root: string): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8")) as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = pkg[field];
      if (typeof deps === "object" && deps !== null && !Array.isArray(deps)) for (const n of Object.keys(deps)) names.add(n);
    }
  } catch {
    // package.json 없음
  }
  return names;
}

// ───────────────────────── 최소 AST 모양 ─────────────────────────

interface Base {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number } };
}
interface Id extends Base {
  name: string;
}
interface StrLit extends Base {
  value: string;
}
interface Spec extends Base {
  local: Id;
  imported?: Id | StrLit;
  importKind?: string | null;
}
interface ImportDecl extends Base {
  specifiers: Spec[];
  source: StrLit;
  importKind?: string | null;
}
/** 속성 값·표현식을 읽는 데 필요한 필드만 모은 느슨한 모양 */
interface Expr extends Base {
  value?: string | number | boolean;
  name?: string;
  expression?: Expr;
  expressions?: Expr[];
  quasis?: { value: { cooked?: string | null; raw: string } }[];
  consequent?: Expr;
  alternate?: Expr;
  left?: Expr;
  right?: Expr;
}
interface Attr extends Base {
  name?: Base & { name?: string | Id; namespace?: Id };
  value?: Expr | null;
}
interface Opening extends Base {
  name: Base & { name?: string };
  attributes: Attr[];
}

const lineOf = (n: Base): number => n.loc?.start.line ?? 1;

function walk(node: unknown, visit: (n: Base) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const n = node as Record<string, unknown>;
  if (typeof n.type === "string") visit(node as Base);
  for (const [key, value] of Object.entries(n)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    if (typeof value === "object" && value !== null) walk(value, visit);
  }
}

function programBody(code: string, file: string): Base[] | null {
  try {
    return parseTsx(code, file).program.body as unknown as Base[];
  } catch {
    return null;
  }
}

// ───────────────────────── 대상 해석 ─────────────────────────

/** 정의 파일 소스에서 `name`의 내보내기 방식. 직접 내보내지 않으면 null */
export function exportKindOf(code: string, file: string, name: string): "named" | "default" | null {
  const body = programBody(code, file);
  if (body === null) return null;
  let named = false;
  let isDefault = false;
  for (const stmt of body) {
    if (stmt.type === "ExportDefaultDeclaration") {
      isDefault = true;
    } else if (stmt.type === "ExportNamedDeclaration") {
      const s = stmt as Base & { declaration?: (Base & { id?: Id; declarations?: { id: Base & { name?: string } }[] }) | null; specifiers?: { exported: Id | StrLit }[] };
      const d = s.declaration;
      if (d?.id?.name === name) named = true;
      for (const decl of d?.declarations ?? []) if (decl.id.type === "Identifier" && decl.id.name === name) named = true;
      for (const spec of s.specifiers ?? []) {
        const exported = spec.exported as Id & StrLit;
        if ((exported.name ?? exported.value) === name) named = true;
      }
    }
  }
  return named ? "named" : isDefault ? "default" : null;
}

function filesUsing(index: Index, item: string, kind: DecisionKind, options: string[]): number {
  const files = new Set<string>();
  for (const c of index.components) {
    if (kind === "duplicate" ? (c.imported ?? c.name) !== item : c.name !== item) continue;
    if (kind === "duplicate" ? options.includes(c.module) : c.declaredLocally === true && options.includes(c.file)) files.add(c.file);
  }
  return files.size;
}

/** 네이티브 속성을 물려주는 것이 분명한 타입(`ButtonHTMLAttributes<…>`, `ComponentProps<"button">` …) */
const DOM_INHERIT = /(?:^|[.\s])(?:\w*HTMLAttributes|DOMAttributes|AriaAttributes|HTMLProps)\b|ComponentProps(?:WithoutRef|WithRef)?\s*<\s*["']/;

const isPackageModule =(module: string, deps: Set<string>): boolean =>
  (module.startsWith("@") && !module.startsWith("@/")) || deps.has(normalizePackageSpecifier(module)) || !module.includes("/");

/**
 * 결정(decisions.json)에서 치환 대상을 만든다. 결정이 끝나고 stale이 아닌 duplicate·local-definition만 대상이고,
 * pending·stale은 `pending`에 (항목, 그 이름을 쓰는 파일 수)로 집계한다. token-cluster는 무시한다(토큰 경로가 처리).
 */
export async function resolveChosenTargets(
  root: string,
  decisions: DecisionsFile,
  index: Index,
): Promise<{ targets: ChosenTarget[]; pending: { item: string; kind: DecisionKind; files: number }[] }> {
  const catalog = await readCatalog(root).catch(() => null);
  const deps = await dependencyNames(root);
  const targets: ChosenTarget[] = [];
  const pending: { item: string; kind: DecisionKind; files: number }[] = [];

  for (const listed of listDecisions(index, decisions)) {
    if (listed.kind === "token-cluster") continue;
    const record = decisions.items.find((r) => r.item === listed.item && r.kind === listed.kind);
    const options = record?.options ?? listed.options;
    if (listed.status !== "decided" || listed.stale === true || record?.chosen === undefined) {
      pending.push({ item: listed.item, kind: listed.kind, files: filesUsing(index, listed.item, listed.kind, options) });
      continue;
    }
    const chosen = record.chosen;
    const item = listed.item;
    const mapping = record.mapping ?? {};

    let module: string;
    let file: string | null;
    if (listed.kind === "local-definition") {
      module = moduleOfFile(chosen);
      file = chosen;
    } else {
      module = chosen;
      file = await resolveDefinitionFile(root, chosen);
    }

    let code: string | null = null;
    if (file !== null) {
      try {
        code = await fs.readFile(path.resolve(root, file), "utf-8");
      } catch {
        code = null;
      }
    }
    let exportKind: ChosenTarget["exportKind"] = null;
    if (file !== null) exportKind = code === null ? null : exportKindOf(code, file, item);
    else if (isPackageModule(module, deps)) exportKind = "named";

    let props: string[] | null = null;
    let inherits: string[] = [];
    let propValues: Record<string, string[]> = {};
    const fromCatalog = catalog?.components.find(
      (c) => c.name === item && (c.module === module || c.modules?.includes(module) === true) && c.propsStatus === "ok",
    );
    if (fromCatalog !== undefined) {
      props = fromCatalog.props.map((p) => p.name);
      inherits = fromCatalog.inherits ?? [];
      for (const p of fromCatalog.props) if (p.values !== undefined && p.values.length > 0) propValues[p.name] = p.values;
    } else if (code !== null && file !== null) {
      const read = readComponentProps(code, file, item);
      if (read !== null) {
        props = read.props.map((p) => p.name);
        inherits = read.inherits;
        propValues = {};
        for (const p of read.props) if (p.values !== undefined && p.values.length > 0) propValues[p.name] = p.values;
      }
    }

    // 상속한 타입 중 DOM 속성 타입이 아닌 것: 같은 파일의 cva variants로 풀 수 있으면 props·허용 값에 더하고, 못 풀면 unknownInherits
    const unknownInherits: string[] = [];
    if (props !== null) {
      for (const text of inherits) {
        if (DOM_INHERIT.test(text)) continue;
        const variantProps = /^VariantProps\s*<\s*typeof\s+([A-Za-z_$][\w$]*)\s*>$/.exec(text.trim());
        const variants = variantProps !== null && code !== null && file !== null ? readCvaVariants(code, file, variantProps[1]!) : null;
        if (variants === null) {
          unknownInherits.push(text);
          continue;
        }
        for (const [name, values] of Object.entries(variants)) {
          if (!props.includes(name)) props.push(name);
          propValues[name] = values;
        }
      }
    }

    targets.push({
      item,
      kind: listed.kind,
      module,
      file,
      exportKind,
      props,
      mapping,
      options,
      ...(inherits.length > 0 ? { inherits } : {}),
      ...(unknownInherits.length > 0 ? { unknownInherits } : {}),
      ...(Object.keys(propValues).length > 0 ? { propValues } : {}),
    });
  }
  return { targets, pending };
}

// ───────────────────────── 파일 편집 ─────────────────────────

const PASSTHROUGH = /^(?:key|ref|children|className|style|aria-.+|data-.+)$/;
const NATIVE_ATTRS = new Set([
  "id", "title", "name", "value", "type", "disabled", "form", "formAction", "formEncType", "formMethod", "formNoValidate", "formTarget",
  "tabIndex", "role", "lang", "dir", "hidden", "href", "target", "rel", "download", "placeholder", "autoFocus", "autoComplete", "required",
  "readOnly", "htmlFor", "accessKey", "draggable", "slot", "translate", "spellCheck", "contentEditable", "inputMode", "defaultValue",
  "checked", "defaultChecked", "min", "max", "step", "pattern", "maxLength", "minLength", "rows", "cols", "src", "alt", "width", "height",
]);

const isNativeAttr = (name: string): boolean => NATIVE_ATTRS.has(name) || /^on[A-Z]/.test(name);

interface FileCtx {
  file: string;
  code: string;
  eol: string;
  body: Base[];
  decls: { node: ImportDecl; key: string }[];
  tsPaths: TsPaths | null;
  openings: Opening[] | null;
}

function openingsOf(ctx: FileCtx): Opening[] {
  if (ctx.openings === null) {
    const found: Opening[] = [];
    walk(ctx.body, (n) => {
      if (n.type === "JSXOpeningElement") found.push(n as Opening);
    });
    ctx.openings = found;
  }
  return ctx.openings;
}

const importedName = (s: Spec): string | null => (s.imported === undefined ? null : ((s.imported as Id).name ?? (s.imported as StrLit).value));

interface MovedSpec {
  decl: ImportDecl;
  spec: Spec;
  local: string;
}

interface ItemPlan {
  target: ChosenTarget;
  moves: MovedSpec[];
  props: PlannedComponentEdit[];
}

function attrName(a: Attr): string | null {
  const n = a.name;
  if (n === undefined) return null;
  if (n.type === "JSXIdentifier") return n.name as string;
  if (n.type === "JSXNamespacedName") return `${(n.namespace as Id).name}:${(n.name as Id).name}`;
  return null;
}

interface AttrOut {
  patches: { patch: TextPatch; detail: string }[];
  missing: string[];
  /** 상속 타입을 확인할 수 없어 props에서 찾지 못한 prop */
  unverifiable: string[];
  /** 이름을 바꾸면 같은 요소에 같은 속성이 둘이 되는 경우 */
  conflicts: string[];
  spread: boolean;
}

/**
 * 속성 값이 가질 수 있는 문자열 잎: 문자열·무치환 템플릿·숫자·불리언 리터럴, 조건·논리식의 양쪽 가지.
 * `null`·`undefined`는 값이 없는 가지로 건너뛰고, 그 밖의 표현식이 하나라도 있으면 null(동적 — 검증 불가)
 */
function valueLeaves(node: Expr | undefined): string[] | null {
  if (node === undefined) return null;
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return [String(node.value)];
    case "NullLiteral":
      return [];
    case "Identifier":
      return node.name === "undefined" ? [] : null;
    case "TemplateLiteral": {
      const only = node.quasis?.[0];
      return (node.expressions?.length ?? 0) === 0 && node.quasis?.length === 1 && only !== undefined ? [only.value.cooked ?? only.value.raw] : null;
    }
    case "ConditionalExpression": {
      const a = valueLeaves(node.consequent);
      const b = valueLeaves(node.alternate);
      return a === null || b === null ? null : [...a, ...b];
    }
    case "LogicalExpression": {
      const a = valueLeaves(node.left);
      const b = valueLeaves(node.right);
      return a === null || b === null ? null : [...a, ...b];
    }
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return valueLeaves(node.expression);
    default:
      return null;
  }
}

/** 속성 값의 잎: 값 없음(`<B disabled />`) → undefined, 문자열 리터럴 → [값], 표현식 → valueLeaves */
function attrLeaves(value: Expr | null): string[] | null | undefined {
  if (value === null) return undefined;
  if (value.type === "StringLiteral") return [value.value as string];
  if (value.type === "JSXExpressionContainer") return valueLeaves(value.expression);
  return null;
}

const nameOfSide = (side: string): string => (side.includes("=") ? side.slice(0, side.indexOf("=")) : side);

/** 한 요소의 속성을 검사하고 mapping으로 바꿀 패치를 만든다. 문제가 있으면 missing·spread·conflicts */
function checkAttributes(ctx: FileCtx, t: ChosenTarget, el: Opening, out: AttrOut): void {
  const valueKeys = new Set(Object.keys(t.mapping).filter((k) => k.includes("=")).map((k) => k.slice(0, k.indexOf("="))));
  // 상속 타입을 모르는 대상: mapping에 이름이 나온 prop(항등 포함)은 사용자가 확인한 것으로 본다
  const unknownInherits = t.unknownInherits ?? [];
  const asserted = new Set<string>();
  if (unknownInherits.length > 0) for (const [from, to] of Object.entries(t.mapping)) asserted.add(nameOfSide(from)).add(nameOfSide(to));
  const finals: { from: string; to: string }[] = [];
  for (const attr of el.attributes) {
    if (attr.type === "JSXSpreadAttribute") {
      out.spread = true;
      continue;
    }
    const name = attrName(attr);
    if (name === null) continue;
    const valueNode = attr.value ?? null;
    const literal = valueNode !== null && valueNode.type === "StringLiteral" ? (valueNode.value as string) : undefined;
    const leaves = attrLeaves(valueNode);

    let finalName = name;
    let finalValue = literal;
    let mappedValue = false;
    const byValue = literal === undefined ? undefined : t.mapping[`${name}=${literal}`];
    if (byValue !== undefined) {
      const at = byValue.indexOf("=");
      finalName = byValue.slice(0, at);
      finalValue = byValue.slice(at + 1);
      mappedValue = true;
    } else if (t.mapping[name] !== undefined) {
      finalName = t.mapping[name]!;
    } else if (valueKeys.has(name) && literal === undefined && valueNode !== null) {
      out.missing.push(`${name}={…}(값 대응 불가)`);
      continue;
    }

    finals.push({ from: name, to: finalName });

    if (!PASSTHROUGH.test(finalName) && t.props !== null) {
      const known = t.props.includes(finalName) || ((t.inherits?.length ?? 0) > 0 && isNativeAttr(finalName));
      if (!known && !(unknownInherits.length > 0 && asserted.has(finalName))) {
        const label = finalName === name ? name : `${name}→${finalName}`;
        if (unknownInherits.length > 0) out.unverifiable.push(label);
        else out.missing.push(label);
        continue;
      }
    }
    const allowed = t.propValues?.[finalName];
    if (allowed !== undefined) {
      const values = mappedValue ? (finalValue === undefined ? undefined : [finalValue]) : leaves;
      if (values === null) {
        out.missing.push(`동적 값: ${finalName}`);
        continue;
      }
      const bad = (values ?? []).filter((v) => !allowed.includes(v));
      if (bad.length > 0) {
        for (const v of new Set(bad)) out.missing.push(`${finalName}="${v}"`);
        continue;
      }
    }

    if (finalName === name && !mappedValue) continue;
    const nameNode = attr.name!;
    if (mappedValue && valueNode !== null && finalValue !== undefined) {
      const q0 = ctx.code[valueNode.start]!;
      const q = finalValue.includes(q0) ? (q0 === '"' ? "'" : '"') : q0;
      if (finalValue.includes(q)) {
        out.missing.push(`${finalName}="${finalValue}"(따옴표 충돌)`);
        continue;
      }
      const between = ctx.code.slice(nameNode.end, valueNode.start);
      out.patches.push({
        patch: { start: nameNode.start, end: valueNode.end, replacement: `${finalName}${between}${q}${finalValue}${q}` },
        detail: `${ctx.code.slice(nameNode.start, valueNode.end)} → ${finalName}=${q}${finalValue}${q}`,
      });
    } else {
      out.patches.push({
        patch: { start: nameNode.start, end: nameNode.end, replacement: finalName },
        detail: `${name} → ${finalName}`,
      });
    }
  }
  // 이름을 바꾼 속성이 같은 요소의 다른 속성과 같은 이름이 되면 속성이 중복된다
  const byFinal = new Map<string, { from: string; to: string }[]>();
  for (const f of finals) byFinal.set(f.to, [...(byFinal.get(f.to) ?? []), f]);
  for (const [to, list] of byFinal) {
    const renamed = list.filter((f) => f.from !== f.to);
    if (list.length > 1 && renamed.length > 0) out.conflicts.push(`${list.map((f) => f.from).join(", ")}이(가) 모두 ${to}가 되어 속성이 중복됨(이름을 바꾸는 쪽: ${renamed.map((f) => `${f.from}→${f.to}`).join(", ")})`);
  }
}

/** 이름을 가리키지 않는 Identifier 자리: 멤버 접근의 속성, 객체·클래스·타입 멤버의 키, 정규화된 타입 이름의 오른쪽 */
function isNonReference(parent: Base | null, key: string): boolean {
  if (parent === null) return false;
  const computed = (parent as Base & { computed?: boolean }).computed === true;
  if ((parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && key === "property") return !computed;
  if (key === "key" && /^(?:ObjectProperty|ObjectMethod|ClassProperty|ClassMethod|ClassPrivateProperty|ClassAccessorProperty|TSPropertySignature|TSMethodSignature)$/.test(parent.type)) return !computed;
  return parent.type === "TSQualifiedName" && key === "right";
}

/**
 * import를 뺀 코드에서 `locals` 이름이 JSX 여는·닫는 태그(`<Name …>`) 말고 쓰인 첫 곳.
 * `<Name.Group>`(멤버 태그의 뿌리), 호출 인자, 속성 값, 대입·export, `typeof Name` 등을 모두 센다(범위는 따지지 않아 보수적)
 */
function findNonTagUse(body: Base[], locals: Set<string>): { name: string; node: Base } | null {
  let found: { name: string; node: Base } | null = null;
  const record = (name: string, node: Base): void => {
    if (found === null || node.start < found.node.start) found = { name, node };
  };
  const visit = (node: unknown, parent: Base | null, key: string): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent, key);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const n = node as Base & Record<string, unknown>;
    if (typeof n.type !== "string" || n.type === "ImportDeclaration") return;
    if (n.type === "Identifier") {
      if (locals.has(n.name as string) && !isNonReference(parent, key)) record(n.name as string, n);
      return;
    }
    if (n.type === "JSXMemberExpression") {
      let root = n as Base & { object?: Base & Record<string, unknown>; name?: string };
      while (root.type === "JSXMemberExpression" && root.object !== undefined) root = root.object as typeof root;
      if (root.type === "JSXIdentifier" && locals.has(root.name as string)) record(root.name as string, root);
      return;
    }
    for (const [k, value] of Object.entries(n)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      if (typeof value === "object" && value !== null) visit(value, n, k);
    }
  };
  visit(body, null, "");
  return found;
}

/** `locals`(네임스페이스 import 이름)의 `.item` 멤버 사용(`<NS.item>`·`NS.item`) 중 첫 곳 */
function findNamespaceMemberUse(body: Base[], locals: Set<string>, item: string): { local: string; node: Base } | null {
  let found: { local: string; node: Base } | null = null;
  const visit = (node: unknown): void => {
    if (found !== null) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const n = node as Base & Record<string, unknown>;
    if (typeof n.type !== "string" || n.type === "ImportDeclaration") return;
    const object = n.object as (Base & { name?: string }) | undefined;
    const property = n.property as (Base & { name?: string }) | undefined;
    const viaJsx = n.type === "JSXMemberExpression" && object?.type === "JSXIdentifier";
    const viaMember = (n.type === "MemberExpression" || n.type === "OptionalMemberExpression") && n.computed !== true && object?.type === "Identifier";
    if ((viaJsx || viaMember) && object?.name !== undefined && locals.has(object.name) && property?.name === item) {
      found = { local: object.name, node: n };
      return;
    }
    for (const [k, value] of Object.entries(n)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      if (typeof value === "object" && value !== null) visit(value);
    }
  };
  visit(body);
  return found;
}

function planItem(ctx: FileCtx, t: ChosenTarget, held: HeldComponentEdit[]): ItemPlan | null {
  if (t.file !== null && t.file === ctx.file) return null;
  const moves: MovedSpec[] = [];
  let renamed: ImportDecl | null = null;
  const namespaces: { decl: ImportDecl; local: string }[] = [];
  for (const { node, key } of ctx.decls) {
    if (node.importKind === "type" || node.importKind === "typeof") continue;
    if (!t.options.includes(key) || key === t.module) continue;
    for (const spec of node.specifiers) {
      if (spec.importKind === "type" || spec.importKind === "typeof") continue;
      if (spec.type === "ImportNamespaceSpecifier") {
        namespaces.push({ decl: node, local: spec.local.name });
      } else if (spec.type === "ImportDefaultSpecifier") {
        if (spec.local.name === t.item) moves.push({ decl: node, spec, local: spec.local.name });
      } else if (spec.type === "ImportSpecifier") {
        if (importedName(spec) === t.item) moves.push({ decl: node, spec, local: spec.local.name });
        else if (spec.local.name === t.item) renamed = node;
      }
    }
  }
  // `import * as L` + `<L.Item>`: 멤버 접근은 import를 옮겨도 그대로라 재검증이 실패한다 — 계획 단계에서 JSX 태그가 아닌 사용으로 보류한다
  const nsUse = namespaces.length === 0 ? null : findNamespaceMemberUse(ctx.body, new Set(namespaces.map((n) => n.local)), t.item);
  if (nsUse !== null) {
    const decl = namespaces.find((n) => n.local === nsUse.local)!.decl;
    held.push({
      item: t.item,
      file: ctx.file,
      line: lineOf(decl),
      reason: "non-jsx-use",
      detail: `${nsUse.local}.${t.item}을(를) 네임스페이스 import로 사용(${lineOf(nsUse.node)}줄) — prop 대응을 확인할 수 없음`,
    });
    return null;
  }
  if (moves.length === 0 && renamed === null) return null;
  const first = moves[0]?.decl ?? renamed!;
  const hold = (reason: ComponentSkipReason, detail: string, at: Base = first): null => {
    held.push({ item: t.item, file: ctx.file, line: lineOf(at), reason, detail });
    return null;
  };
  if (renamed !== null) return hold("export-unknown", `${t.item}는 다른 이름(as)으로 가져온 것이라 대상의 내보내기와 맞출 수 없음`, renamed);
  if (t.exportKind === null) return hold("export-unknown", `${t.file ?? t.module}에서 ${t.item}의 내보내기 방식을 알 수 없음`);

  const locals = new Set(moves.map((m) => m.local));
  // JSX 여는 태그가 아닌 곳(멤버 태그 `<Button.Group>`, styled(Button), as={Button}, createElement(Button, …), 값 전달)에서 쓰이면 prop을 확인할 수 없다
  const nonTag = findNonTagUse(ctx.body, locals);
  if (nonTag !== null) {
    return hold("non-jsx-use", `${nonTag.name}을(를) JSX 태그가 아닌 곳에서 사용(${lineOf(nonTag.node)}줄) — prop 대응을 확인할 수 없음`, nonTag.node);
  }
  const out: AttrOut = { patches: [], missing: [], unverifiable: [], conflicts: [], spread: false };
  let firstSpread: Opening | null = null;
  for (const el of openingsOf(ctx)) {
    if (el.name.type !== "JSXIdentifier" || !locals.has(el.name.name as string)) continue;
    const before = out.spread;
    checkAttributes(ctx, t, el, out);
    if (!before && out.spread) firstSpread = el;
  }
  if (out.spread) return hold("spread-props", `{...props} 스프레드가 있어 prop 대응을 확인할 수 없음`, firstSpread ?? first);
  if (out.missing.length > 0 || out.unverifiable.length > 0) {
    const dynamic = [...new Set(out.missing.filter((m) => m.startsWith("동적 값:")))];
    const missing = [...new Set(out.missing.filter((m) => !m.startsWith("동적 값:")))];
    const unverifiable = [...new Set(out.unverifiable)];
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`대상 ${t.file ?? t.module}에 없는 prop: ${missing.join(", ")}`);
    if (dynamic.length > 0) parts.push(`${dynamic.join(", ")} (표현식이라 허용 값을 확인할 수 없음)`);
    if (unverifiable.length > 0) {
      const sample = unverifiable[0]!.split("→")[0]!;
      parts.push(`상속 타입 확인 불가: ${(t.unknownInherits ?? []).join(", ")} — ${unverifiable.join(", ")} (직접 확인했다면 decide --map ${sample}:${sample}처럼 같은 이름으로 대응)`);
    }
    return hold("mapping-missing", `${parts.join("; ")} — decide --map으로 대응을 주세요`);
  }
  if (out.conflicts.length > 0) return hold("mapping-conflict", `속성 이름 충돌: ${[...new Set(out.conflicts)].join("; ")}`);
  return {
    target: t,
    moves,
    props: out.patches.map((p) => ({
      item: t.item,
      kind: "prop" as const,
      file: ctx.file,
      line: lineAt(ctx.code, p.patch.start),
      patch: p.patch,
      detail: p.detail,
      group: t.item,
    })),
  };
}

const spaces = /[ \t]/;

/** 선언이 자기 줄을 혼자 쓰면 줄 전체(개행 포함)를, 아니면 선언만 */
function lineRemoval(code: string, node: Base): { start: number; end: number } {
  const lineStart = code.lastIndexOf("\n", node.start - 1) + 1;
  let end = node.end;
  while (end < code.length && spaces.test(code[end]!)) end += 1;
  const atEol = end >= code.length || code[end] === "\n" || code[end] === "\r";
  if (code.slice(lineStart, node.start).trim() === "" && atEol) {
    if (code[end] === "\r" && code[end + 1] === "\n") end += 2;
    else if (code[end] === "\n") end += 1;
    return { start: lineStart, end };
  }
  return { start: node.start, end: node.end };
}

function renderedBinding(t: ChosenTarget, local: string): string {
  return local === t.item ? t.item : `${t.item} as ${local}`;
}

function importLine(ctx: FileCtx, t: ChosenTarget, local: string, decl: ImportDecl): string {
  const spec = specifierForModule(ctx.file, t.module, ctx.tsPaths, t.file !== null ? true : undefined);
  const q = ctx.code[decl.source.start] === "'" ? "'" : '"';
  const semi = ctx.code[decl.end - 1] === ";" ? ";" : "";
  return t.exportKind === "default"
    ? `import ${local} from ${q}${spec}${q}${semi}`
    : `import { ${renderedBinding(t, local)} } from ${q}${spec}${q}${semi}`;
}

/** 기존 선언 중 같은 module의 named import(값)를 합칠 곳 */
function mergeTarget(ctx: FileCtx, t: ChosenTarget, local: string, removing: Set<ImportDecl>): { node: ImportDecl; last: Spec } | null {
  if (t.exportKind !== "named") return null;
  for (const { node, key } of ctx.decls) {
    if (removing.has(node) || key !== t.module || node.importKind === "type" || node.importKind === "typeof") continue;
    if (node.specifiers.some((s) => s.type === "ImportNamespaceSpecifier" || s.local.name === local)) continue;
    const named = node.specifiers.filter((s) => s.type === "ImportSpecifier");
    const last = named[named.length - 1];
    if (last !== undefined) return { node, last };
  }
  return null;
}

/** 지정자 하나가 빠진 뒤의 선언 내 지정자 제거 구간들(옮겨지는 것만, 남는 것이 하나 이상일 때) */
function removalRanges(ctx: FileCtx, decl: ImportDecl, moved: Set<Spec>): { spec: Spec; start: number; end: number }[] {
  const out: { spec: Spec; start: number; end: number }[] = [];
  const { code } = ctx;
  const named = decl.specifiers.filter((s) => s.type === "ImportSpecifier");
  const movedNamed = named.filter((s) => moved.has(s));
  const keptNamed = named.filter((s) => !moved.has(s));
  const def = decl.specifiers.find((s) => s.type === "ImportDefaultSpecifier");

  if (def !== undefined && moved.has(def)) {
    const comma = code.indexOf(",", def.end);
    let end = comma === -1 ? def.end : comma + 1;
    while (end < code.length && /\s/.test(code[end]!)) end += 1;
    out.push({ spec: def, start: def.start, end });
  }
  if (movedNamed.length === 0) return out;

  if (keptNamed.length === 0) {
    // 중괄호 안이 전부 빠진다: 앞 지정자(default)와 중괄호 전체를 지운다
    const close = code.indexOf("}", named[named.length - 1]!.end);
    const prevEnd = def !== undefined && !moved.has(def) ? def.end : named[0]!.start;
    const start = def !== undefined && !moved.has(def) ? prevEnd : code.lastIndexOf("{", named[0]!.start);
    out.push({ spec: movedNamed[0]!, start, end: close + 1 });
    return out;
  }

  // 꼬리에서 연속으로 빠지는 지정자 묶음은 앞 지정자 끝부터 한 번에 지운다
  let tail = named.length;
  while (tail > 0 && moved.has(named[tail - 1]!)) tail -= 1;
  for (let i = 0; i < tail; i++) {
    const s = named[i]!;
    if (moved.has(s)) out.push({ spec: s, start: s.start, end: named[i + 1]!.start });
  }
  if (tail < named.length) {
    out.push({ spec: named[tail]!, start: named[tail - 1]!.end, end: named[named.length - 1]!.end });
  }
  return out;
}

function planDuplicates(ctx: FileCtx, plans: ItemPlan[]): PlannedComponentEdit[] {
  const edits: PlannedComponentEdit[] = [];
  // 한 선언을 함께 쓰는 항목은 한 group
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const p of plans) parent.set(p.target.item, p.target.item);
  const byDecl = new Map<ImportDecl, ItemPlan[]>();
  for (const p of plans) {
    for (const m of p.moves) {
      const list = byDecl.get(m.decl) ?? [];
      if (!list.includes(p)) list.push(p);
      byDecl.set(m.decl, list);
    }
  }
  for (const list of byDecl.values()) for (const p of list.slice(1)) parent.set(find(p.target.item), find(list[0]!.target.item));
  const groupOf = (p: ItemPlan): string => {
    const root = find(p.target.item);
    return plans.filter((q) => find(q.target.item) === root).map((q) => q.target.item).sort().join("+");
  };

  // 선언이 통째로 사라지는가
  const movedBy = new Map<ImportDecl, Set<Spec>>();
  for (const p of plans) for (const m of p.moves) movedBy.set(m.decl, (movedBy.get(m.decl) ?? new Set<Spec>()).add(m.spec));
  const wholeRemoval = new Set<ImportDecl>();
  for (const [decl, moved] of movedBy) if (decl.specifiers.every((s) => moved.has(s))) wholeRemoval.add(decl);

  const seenLines = new Set<string>();
  const pushEdit = (p: ItemPlan, decl: ImportDecl, patch: TextPatch, detail: string): void => {
    edits.push({ item: p.target.item, kind: "import", file: ctx.file, line: lineOf(decl), patch, detail, group: groupOf(p) });
  };

  // 새 줄·합치기 편집(항목별). 선언마다 새 줄 목록을 모은다
  interface NewLine {
    plan: ItemPlan;
    text: string;
    decl: ImportDecl;
  }
  const newLinesByDecl = new Map<ImportDecl, NewLine[]>();
  const anyDetail = (decl: ImportDecl, t: ChosenTarget): string =>
    `${t.item}: "${decl.source.value}" → "${specifierForModule(ctx.file, t.module, ctx.tsPaths, t.file !== null ? true : undefined)}"`;
  for (const p of plans) {
    for (const m of p.moves) {
      const merge = mergeTarget(ctx, p.target, m.local, wholeRemoval);
      if (merge !== null) {
        const text = `, ${renderedBinding(p.target, m.local)}`;
        const key = `merge:${merge.last.end}:${text}`;
        if (seenLines.has(key)) continue;
        seenLines.add(key);
        pushEdit(p, m.decl, { start: merge.last.end, end: merge.last.end, replacement: text }, anyDetail(m.decl, p.target));
        continue;
      }
      const text = importLine(ctx, p.target, m.local, m.decl);
      if (seenLines.has(text)) continue;
      seenLines.add(text);
      const list = newLinesByDecl.get(m.decl) ?? [];
      list.push({ plan: p, text, decl: m.decl });
      newLinesByDecl.set(m.decl, list);
    }
  }

  // 선언별 제거·삽입
  for (const [decl, moved] of movedBy) {
    const lines = newLinesByDecl.get(decl) ?? [];
    const owner = plans.find((p) => p.moves.some((m) => m.decl === decl))!;
    if (wholeRemoval.has(decl)) {
      if (lines.length === 0) {
        const r = lineRemoval(ctx.code, decl);
        pushEdit(owner, decl, { start: r.start, end: r.end, replacement: "" }, anyDetail(decl, owner.target));
      } else {
        const [head, ...rest] = lines;
        pushEdit(head!.plan, decl, { start: decl.start, end: decl.end, replacement: head!.text }, anyDetail(decl, head!.plan.target));
        for (const l of rest) pushEdit(l.plan, decl, { start: decl.end, end: decl.end, replacement: `${ctx.eol}${l.text}` }, anyDetail(decl, l.plan.target));
      }
      continue;
    }
    for (const r of removalRanges(ctx, decl, moved)) {
      const p = plans.find((q) => q.moves.some((m) => m.spec === r.spec)) ?? owner;
      pushEdit(p, decl, { start: r.start, end: r.end, replacement: "" }, anyDetail(decl, p.target));
    }
    for (const l of lines) pushEdit(l.plan, decl, { start: decl.end, end: decl.end, replacement: `${ctx.eol}${l.text}` }, anyDetail(decl, l.plan.target));
  }

  // prop 편집
  for (const p of plans) for (const e of p.props) edits.push({ ...e, group: groupOf(p) });
  return edits;
}

/** 오프셋의 1-based 줄 번호 */
function lineAt(code: string, offset: number): number {
  let n = 1;
  for (let i = code.indexOf("\n"); i !== -1 && i < offset; i = code.indexOf("\n", i + 1)) n += 1;
  return n;
}

// ───────────────────────── 지역 정의 주석 ─────────────────────────

interface DeclStmt extends Base {
  declaration?: (Base & { id?: Id; declarations?: { id: Base & { name?: string } }[] }) | null;
}

/** 파일 최상위에서 `name`을 선언한 문장(export를 감싼 것 포함) */
function topLevelDeclaration(body: Base[], name: string): Base | null {
  const declares = (d: DeclStmt["declaration"] | Base | null | undefined): boolean => {
    if (d === null || d === undefined) return false;
    const x = d as Base & { id?: Id | null; declarations?: { id: Base & { name?: string } }[] };
    if ((x.type === "FunctionDeclaration" || x.type === "ClassDeclaration") && x.id?.name === name) return true;
    return x.type === "VariableDeclaration" && (x.declarations ?? []).some((v) => v.id.type === "Identifier" && v.id.name === name);
  };
  for (const stmt of body) {
    if (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") {
      if (declares((stmt as DeclStmt).declaration)) return stmt;
    } else if (declares(stmt)) {
      return stmt;
    }
  }
  return null;
}

function planAnnotation(ctx: FileCtx, t: ChosenTarget): PlannedComponentEdit | null {
  if (!t.options.includes(ctx.file) || ctx.file === t.file) return null;
  // import로 가져온 이름이면 지역 정의가 아니다
  for (const { node } of ctx.decls) if (node.specifiers.some((s) => s.local.name === t.item)) return null;
  const stmt = topLevelDeclaration(ctx.body, t.item);
  if (stmt === null) return null;
  const spec = specifierForModule(ctx.file, t.module, ctx.tsPaths, t.file !== null ? true : undefined);
  const importText = t.exportKind === "default" ? `import ${t.item} from "${spec}"` : `import { ${t.item} } from "${spec}"`;
  const prefix = `// dsmith: ${t.file ?? t.module}로 통합됨`;
  const comment = `${prefix} — 삭제 검토 (${importText})`;
  // specifier(tsconfig paths)가 바뀌어도 같은 대상 파일의 주석이 이미 있으면 다시 달지 않는다
  if (ctx.code.includes(prefix)) return null;
  const lineStart = ctx.code.lastIndexOf("\n", stmt.start - 1) + 1;
  const indent = ctx.code.slice(lineStart, stmt.start);
  if (indent.trim() !== "") return null;
  return {
    item: t.item,
    kind: "annotate",
    file: ctx.file,
    line: lineOf(stmt),
    patch: { start: lineStart, end: lineStart, replacement: `${indent}${comment}${ctx.eol}` },
    detail: comment,
    group: t.item,
  };
}

// ───────────────────────── 진입점 ─────────────────────────

/** 순수: 한 파일의 편집. 파일 안 한 항목은 전부 하거나 전부 보류(부분 치환 없음) */
export function planComponentEdits(input: {
  file: string;
  code: string;
  targets: ChosenTarget[];
  tsPaths: TsPaths | null;
  moduleContext: ModuleContext;
}): { edits: PlannedComponentEdit[]; held: HeldComponentEdit[] } {
  const { file, code, targets, tsPaths, moduleContext } = input;
  const held: HeldComponentEdit[] = [];
  if (targets.length === 0) return { edits: [], held };
  const body = programBody(code, file);
  if (body === null) return { edits: [], held };

  const decls = body
    .filter((s) => s.type === "ImportDeclaration")
    .map((s) => {
      const node = s as ImportDecl;
      return { node, key: moduleKeyOf(file, node.source.value, tsPaths, moduleContext) };
    });
  const ctx: FileCtx = { file, code, eol: code.includes("\r\n") ? "\r\n" : "\n", body, decls, tsPaths, openings: null };

  const plans: ItemPlan[] = [];
  const annotations: PlannedComponentEdit[] = [];
  for (const t of targets) {
    if (t.kind === "duplicate") {
      const plan = planItem(ctx, t, held);
      if (plan !== null) plans.push(plan);
    } else {
      const a = planAnnotation(ctx, t);
      if (a !== null) annotations.push(a);
    }
  }
  return { edits: [...planDuplicates(ctx, plans), ...annotations], held };
}
