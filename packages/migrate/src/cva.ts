import { parseTsx } from "@dsmith-dev/core";

interface N {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const isNode = (v: unknown): v is N => typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

function keyName(prop: N): string | null {
  if (prop.type !== "ObjectProperty" || prop.computed === true) return null;
  const key = prop.key;
  if (!isNode(key)) return null;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "StringLiteral") return key.value as string;
  if (key.type === "NumericLiteral") return String(key.value);
  return null;
}

/** `{ a: …, "b-c": … }`의 키 목록. 스프레드·계산된 키·메서드가 있으면 전부 알 수 없으므로 null */
function objectKeys(obj: unknown): string[] | null {
  if (!isNode(obj) || obj.type !== "ObjectExpression") return null;
  const keys: string[] = [];
  for (const prop of obj.properties as unknown[]) {
    if (!isNode(prop)) return null;
    const name = keyName(prop);
    if (name === null) return null;
    keys.push(name);
  }
  return keys;
}

function propertyValue(obj: N, name: string): unknown {
  for (const prop of obj.properties as unknown[]) if (isNode(prop) && keyName(prop) === name) return prop.value;
  return undefined;
}

/**
 * 같은 파일 최상위의 `const <varName> = cva(base, { variants: { <prop>: { <value>: … } } })`에서
 * variant 이름 → 값(키) 목록을 읽는다. cva 호출이 아니거나 variants 모양을 읽을 수 없으면 null
 */
export function readCvaVariants(code: string, file: string, varName: string): Record<string, string[]> | null {
  let body: unknown[];
  try {
    body = parseTsx(code, file).program.body as unknown[];
  } catch {
    return null;
  }
  for (const stmt of body) {
    if (!isNode(stmt)) continue;
    const decl = stmt.type === "ExportNamedDeclaration" && isNode(stmt.declaration) ? stmt.declaration : stmt;
    if (decl.type !== "VariableDeclaration") continue;
    for (const d of decl.declarations as unknown[]) {
      if (!isNode(d) || !isNode(d.id) || d.id.type !== "Identifier" || d.id.name !== varName) continue;
      const call = d.init;
      if (!isNode(call) || call.type !== "CallExpression" || !isNode(call.callee) || call.callee.type !== "Identifier" || call.callee.name !== "cva") return null;
      const config = (call.arguments as unknown[])[1];
      if (!isNode(config) || config.type !== "ObjectExpression") return null;
      const variants = propertyValue(config, "variants");
      if (!isNode(variants) || variants.type !== "ObjectExpression") return null;
      const out: Record<string, string[]> = {};
      for (const prop of variants.properties as unknown[]) {
        if (!isNode(prop)) return null;
        const name = keyName(prop);
        const values = objectKeys(prop.value);
        if (name === null || values === null) return null;
        out[name] = values;
      }
      return out;
    }
  }
  return null;
}
