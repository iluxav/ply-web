// The package page's manifest-derived UI: real `ply run`/`ply up` examples
// (with the `-e` flags a standalone run needs for secret-backed env), the
// `[[app]]` member snippet a consumer can paste into their own stack, the
// `{member.param}` references they can write, and a stack's member table.
// Pure and hand-testable — the page supplies `pkg`/`latest` from state.json
// and `manifest` from `manifestSource()` + `parseManifest()`.
import { kindOf, type Manifest } from "./manifest";
import { paramRows, type RegistryPackage, type RegistryVersion } from "./registry";

const table = (m: Manifest, key: string): Record<string, unknown> => {
  const v = m[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// name@version and owner/name@version share the "next minor" pin every ref
// on this page uses: the manifest is the record, but a consumer follows a
// range, not a hash.
const range = (version: string) => version.split(".").slice(0, 2).join(".");

const ref = (pkg: RegistryPackage, version: string) =>
  pkg.namespace === "ply" ? `${pkg.name}@${range(version)}` : `${pkg.namespace}/${pkg.name}@${range(version)}`;

// The image basename of a `run =` ref, ignoring its version — what a member
// is called when the `[[app]]` block does not set `name` itself. Mirrors
// ply-core's `classify_run` (ply-core/src/stack.rs): a URL or path ref takes
// its last path segment, strips a trailing `.img`, then cuts at the first
// `-` (so `postgres-17.10.7-x64.img` → `postgres`); a registry ref
// (`name@version` / `owner/name@version`) just drops the version and takes
// the basename — no `-` cut, so `iluxav/todos-server@0.1` stays
// `todos-server`.
const defaultMemberName = (run: string): string => {
  const lastSegment = (s: string) => s.split("/").pop() || s;
  if (run.startsWith("http://") || run.startsWith("https://")) {
    const stem = lastSegment(run).split("-")[0];
    return stem || lastSegment(run);
  }
  if (run.startsWith("./") || run.startsWith("../") || run.startsWith("/") || run.endsWith(".img")) {
    const file = lastSegment(run);
    const withoutImg = file.endsWith(".img") ? file.slice(0, -".img".length) : file;
    const stem = withoutImg.split("-")[0];
    return stem || withoutImg;
  }
  const withoutVersion = run.split("@")[0];
  return lastSegment(withoutVersion);
};

// TOML basic-string escaping for a value interpolated into the `[[app]]`
// snippet, so a default containing `"` or `\` still parses.
const escapeTomlString = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export function secretEnvFlags(manifest: Manifest | null): string[] {
  if (!manifest) return [];
  const env = table(manifest, "env");
  const params = table(manifest, "params");
  const flags: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    const hole = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
    if (!hole) continue;
    const decl = params[hole[1]];
    const isSecret = decl && typeof decl === "object" && !Array.isArray(decl) && (decl as { secret?: boolean }).secret === true;
    if (isSecret) flags.push(`-e ${key}=…`);
  }
  return flags.sort();
}

export function runExample(pkg: RegistryPackage, latest: RegistryVersion, manifest: Manifest | null): string {
  if (!manifest) return "";
  const kind = kindOf(manifest);
  if (kind === "layer") return "";
  const verb = kind === "stack" ? "up" : "run";
  const parts = [`ply ${verb} ${ref(pkg, latest.version)}`, ...secretEnvFlags(manifest)];
  return parts.join(" ");
}

// Both take the parsed manifest solely as the "this record has a manifest
// to show" gate — a v3-bridge record (type already "app" in state.json, but
// manifest not yet backfilled) must render exactly as it did before this
// feature, not grow a new block state.json alone can't back up.
export function memberSnippet(pkg: RegistryPackage, latest: RegistryVersion, manifest: Manifest | null): string {
  if (!manifest || pkg.type !== "app") return "";
  const rows = paramRows(latest.params);
  const overridable = rows.filter((r) => r.kind === "default");
  const lines = [`[[app]]`, `run = "${ref(pkg, latest.version)}"`, `name = "${pkg.name}"`];
  if (overridable.length > 0) {
    lines.push(`params = { ${overridable[0].name} = "${escapeTomlString(overridable[0].value ?? "")}" }`);
    lines.push(`# overridable: ${overridable.map((r) => r.name).join(", ")}`);
  }
  return lines.join("\n");
}

const BUILT_IN_FACTS = ["host", "port", "addr", "base_url"];

export function referenceLines(pkg: RegistryPackage, latest: RegistryVersion, manifest: Manifest | null): string[] {
  if (!manifest || pkg.type !== "app") return [];
  const rows = paramRows(latest.params);
  if (rows.length === 0) return [];
  return [
    ...rows.map((r) => `{${pkg.name}.${r.name}}`),
    ...BUILT_IN_FACTS.map((f) => `{${pkg.name}.${f}}`),
  ];
}

export type StackMember = {
  run: string;
  name: string;
  params: Record<string, string>;
  env: string[];
  publish: string[];
  after: string[];
  refs: string[];
};

export function stackMembers(manifest: Manifest | null): StackMember[] {
  if (!manifest || kindOf(manifest) !== "stack") return [];
  const apps = Array.isArray(manifest.app) ? (manifest.app as unknown[]) : [];
  return apps.map((raw) => {
    const a = (raw ?? {}) as Record<string, unknown>;
    const run = str(a.run);
    const name = str(a.name) || defaultMemberName(run);
    const paramsTable = a.params && typeof a.params === "object" && !Array.isArray(a.params) ? (a.params as Record<string, unknown>) : {};
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(paramsTable)) params[k] = typeof v === "string" ? v : String(v);
    const env = strArray(a.e);
    const refs = new Set<string>();
    for (const e of env) {
      for (const m of e.matchAll(/\{([^.{}]+\.[^{}]+)\}/g)) refs.add(`{${m[1]}}`);
    }
    return {
      run,
      name,
      params,
      env,
      publish: strArray(a.publish),
      after: strArray(a.after),
      refs: [...refs],
    };
  });
}
