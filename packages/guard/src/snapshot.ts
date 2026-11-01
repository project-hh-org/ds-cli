import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_EXCLUDE,
  DEFAULT_GUARD_POLICY,
  collectModuleContext,
  findInitDir,
  findTailwindConfig,
  listCssFiles,
  listDecisions,
  loadReplacementTokens,
  readCatalog,
  readDecisions,
  readIndex,
  readTailwindPreset,
  readTsconfigPaths,
  sha256Text,
  type GuardPolicy,
  type GuardSnapshot,
} from "@dsmith-dev/core";
import type { DetectResult } from "@dsmith-dev/detect";

export interface BuildGuardSnapshotOptions {
  root: string;
  detect: DetectResult;
  version: string;
  /** 기존 `.dsmith/guard.json`(없거나 깨졌으면 null) — policy를 이어받는다 */
  existing: GuardSnapshot | null;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function dsModulesOf(ds: DetectResult["ds"]): string[] {
  if (ds.kind === "npm") return ds.packageNames ?? (ds.packageName !== undefined ? [ds.packageName] : []);
  if (ds.kind === "local" && ds.dir !== undefined) return [ds.dir];
  return [];
}

async function fileHash(root: string, file: string): Promise<string | null> {
  try {
    return sha256Text(await fs.readFile(path.resolve(root, file), "utf-8"));
  } catch {
    return null;
  }
}

function clonePolicy(p: GuardPolicy): GuardPolicy {
  return {
    allow: { files: [...p.allow.files], properties: [...p.allow.properties] },
    minConfidence: p.minConfidence,
    failOn: { newHardcoded: p.failOn.newHardcoded, deprecated: p.failOn.deprecated },
  };
}

/**
 * 규칙 엔진이 쓰는 레포 기준을 `.dsmith/guard.json` 모양으로 모은다. 타임스탬프·절대 경로 없음.
 * tokens = loadReplacementTokens(제안 없음), tokenFiles = 그 파일들의 sha256Text.
 */
export async function buildGuardSnapshot(opts: BuildGuardSnapshotOptions): Promise<GuardSnapshot> {
  const { root, detect, version, existing } = opts;

  const replacement = await loadReplacementTokens(root, detect.ds.tokenFiles);
  const tokens = replacement.tokens.map((t) => ({
    name: t.name,
    value: t.value,
    category: t.category,
    normalized: t.normalized,
    ...(t.path !== undefined ? { path: t.path } : {}),
  }));
  const tokenFiles: GuardSnapshot["tokenFiles"] = [];
  // 토큰 파일 + Tailwind 설정·프리셋 파일: 나중에 프리셋을 연결하거나 고치면 stale로 잡힌다
  const initDir = await findInitDir(root);
  const preset = await readTailwindPreset(root, {
    initDir: initDir,
    ...(detect.styling.tailwindVersion !== undefined ? { tailwindVersion: detect.styling.tailwindVersion } : {}),
    cssFiles: initDir === null ? [] : await listCssFiles(root),
  });
  const twConfig = await findTailwindConfig(root);
  const hashed = [...new Set([...replacement.files, ...(twConfig !== null ? [twConfig] : []), ...(preset !== null ? [preset.file] : [])])];
  for (const file of hashed.sort(byCodeUnit)) {
    const sha256 = await fileHash(root, file);
    if (sha256 !== null) tokenFiles.push({ file, sha256 });
  }

  const catalog = await readCatalog(root);
  const components: GuardSnapshot["ds"]["components"] = (catalog?.components ?? []).map((c) => ({
    name: c.name,
    module: c.module,
    ...(c.modules !== undefined ? { modules: c.modules } : {}),
    ...(c.deprecated !== undefined ? { deprecated: c.deprecated } : {}),
    ...(c.status !== undefined ? { status: c.status } : {}),
  }));
  const modules = [
    ...new Set([...dsModulesOf(detect.ds), ...components.flatMap((c) => [c.module, ...(c.modules ?? [])]).filter((m) => m !== "")]),
  ].sort(byCodeUnit);

  // decided duplicate → 이 이름은 이 module로. stale(고른 module이 선택지에서 사라짐)이면 뺀다.
  const decisions = await readDecisions(root).catch(() => ({ version: 1 as const, items: [] }));
  const index = await readIndex(root).catch(() => null);
  const staleItems = new Set(
    index === null ? [] : listDecisions(index, decisions, "decided").filter((d) => d.kind === "duplicate" && d.stale === true).map((d) => d.item),
  );
  const preferred = decisions.items
    .filter((r) => r.kind === "duplicate" && r.status === "decided" && r.chosen !== undefined && !staleItems.has(r.item))
    .map((r) => ({ name: r.item, module: r.chosen as string }))
    .sort((a, b) => byCodeUnit(a.name, b.name) || byCodeUnit(a.module, b.module));

  const dirGlobs = replacement.excludeDirs.filter((d) => d !== ".").map((d) => `${d}/**`);
  const exclude = [
    ...new Set([...DEFAULT_EXCLUDE, ...(detect.overrides?.exclude ?? []), ...dirGlobs, ...[...replacement.excludeFiles].sort(byCodeUnit)]),
  ];

  const tsPaths = await readTsconfigPaths(root);
  const mc = await collectModuleContext(root, tsPaths);

  return {
    version: 1,
    dsmith: version,
    extractors: [...detect.activeExtractors],
    tokens,
    tokenSource: replacement.source,
    tokenFiles,
    ds: { modules, components },
    preferred,
    preset,
    exclude,
    moduleContext: {
      tsPaths,
      // 점으로 시작하는 항목(.github 등)은 bare import가 될 수 없고, guard init이 만드는 디렉터리라 두 번째 실행의 결과를 흔든다
      baseUrlEntries: [...(mc.baseUrlEntries ?? [])].filter((e) => !e.startsWith(".")).sort(byCodeUnit),
      // guard init이 devDependencies에 더하는 플러그인은 뺀다 — 안 빼면 첫 실행과 두 번째 실행의 guard.json이 달라진다
      dependencies: [...(mc.dependencies ?? [])].filter((d) => d !== "@dsmith-dev/eslint-plugin").sort(byCodeUnit),
    },
    policy: clonePolicy(existing?.policy ?? DEFAULT_GUARD_POLICY),
  };
}
