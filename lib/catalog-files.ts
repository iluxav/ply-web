// Everything a consumer reads is a file: index.json, the manifest, and the
// state snapshots. All of them are functions of the records table, so a
// rebuild is always possible and the database is never a consumer's concern.
import { derive, type StoredRecord } from "./manifest";
import { getObject, putObject } from "./r2";
import { listRecords } from "./records";

export const REGISTRY = "https://registry.plybox.sh";
export const tomlUrl = (owner: string, name: string, version: string) => `${REGISTRY}/${owner}/${name}/${name}-${version}.toml`;
const hosted = (src: string, owner: string, name: string) => src.startsWith(`${REGISTRY}/${owner}/${name}/`);
// The last path segment, VERBATIM. Never percent-decoded: an R2 key is the
// literal bytes of the src's last segment, and `decodeURIComponent` throws
// on a lone `%` — which, on the publish path, threw after the record was
// already saved and 500'd every later publish in the namespace.
const basename = (u: string) => u.split("/").at(-1) ?? "";

/// `dependencies` is the v2 array `[{name, version}]`, NOT the object
/// `derive()` builds internally: every released ply declares
/// `ImageVersion.dependencies: Vec<Dep>` and parses state.json in one
/// `from_str` over the whole document, so an object here fails the entire
/// catalog for `ply search`/`add`/`up` on every CLI already in the wild.
/// The wire stays additive — new KEYS only, never a changed type.
export type VersionEntry = {
  version: string; img: string | null; arch?: "x64" | "arm64"; src: string; sha256?: string; bytes: number;
  pushed_at: string; manifest?: string; verified?: boolean;
  volumes?: string[]; links?: string[]; publish?: string; dependencies?: { name: string; version: string }[]; params?: Record<string, unknown>;
};
export type OwnerPackage = {
  namespace: string; owner: string; name: string; type: string; description: string; license: string; homepage: string; versions: VersionEntry[];
};

export function versionEntries(rec: StoredRecord): VersionEntry[] {
  const d = derive(rec.manifest);
  const manifestUrl = tomlUrl(rec.owner, rec.name, rec.version);
  const legacy = rec.manifest_toml === "";
  // The v3 bridge (one release): a manifest-less legacy record has no toml
  // to point at, so the `manifest` field is omitted rather than dangling.
  const manifestField = legacy ? {} : { manifest: manifestUrl };
  const extras = {
    ...(d.volumes.length ? { volumes: d.volumes } : {}),
    ...(d.links.length ? { links: d.links } : {}),
    ...(d.publish ? { publish: d.publish } : {}),
    ...(Object.keys(d.dependencies).length
      ? { dependencies: Object.entries(d.dependencies).map(([name, version]) => ({ name, version })) }
      : {}),
    ...(Object.keys(d.params).length ? { params: d.params } : {}),
  };
  if (rec.type === "stack" || rec.artifacts.length === 0) {
    // A legacy stack (manifest-less) was stored by the old push route as its
    // uploaded <name>-<version>.stack.toml, not the v3 <name>-<version>.toml
    // — that file doesn't exist, so don't point src at it.
    const src = rec.type === "stack" && legacy
      ? `${REGISTRY}/${rec.owner}/${rec.name}/${rec.name}-${rec.version}.stack.toml`
      : manifestUrl;
    return [{ version: rec.version, img: null, src, bytes: 0, pushed_at: rec.pushed_at, ...manifestField, ...extras }];
  }
  return rec.artifacts.map((a) => ({
    version: rec.version, img: basename(a.src), arch: a.arch, src: a.src, sha256: a.sha256, bytes: a.bytes,
    pushed_at: rec.pushed_at, ...manifestField, verified: a.verified, ...extras,
  }));
}

export function ownerPackages(records: StoredRecord[]): OwnerPackage[] {
  const byName = new Map<string, OwnerPackage>();
  const sorted = [...records].sort((a, b) => a.name.localeCompare(b.name) || a.pushed_at.localeCompare(b.pushed_at));
  for (const r of sorted) {
    const d = derive(r.manifest);
    // The manifest is the record — but a boot-seeded row carries `manifest
    // {}` until the backfill runs, and the only description/license/homepage
    // that exists for it is the `packages` row the legacy push wrote. Read
    // the manifest first, fall back to the columns, so nothing empties out
    // during the rollout window.
    const fields = {
      description: d.description || r.description || "",
      license: d.license || r.license || "",
      homepage: d.homepage || r.homepage || "",
    };
    const pkg = byName.get(r.name) ?? {
      namespace: r.owner, owner: r.owner, name: r.name, type: r.type, ...fields, versions: [],
    };
    // the newest record's package fields win (records are sorted by pushed_at)
    Object.assign(pkg, { type: r.type, ...fields });
    pkg.versions.push(...versionEntries(r));
    byName.set(r.name, pkg);
  }
  return [...byName.values()];
}

export function indexFilenames(records: StoredRecord[], name: string): string[] {
  const out: string[] = [];
  for (const r of records.filter((x) => x.name === name)) {
    for (const a of r.artifacts) if (hosted(a.src, r.owner, r.name)) out.push(basename(a.src));
    if (r.manifest_toml !== "") out.push(`${r.name}-${r.version}.toml`);
  }
  return out.sort();
}

type Sql = NonNullable<Awaited<ReturnType<typeof import("./db").ready>>>;

export async function writeCatalogFiles(sql: Sql, owner: string, name: string): Promise<void> {
  const records = await listRecords(sql, owner);
  for (const r of records.filter((x) => x.name === name && x.manifest_toml !== "")) {
    await putObject(`${owner}/${name}/${name}-${r.version}.toml`, r.manifest_toml, "application/toml", "public, max-age=31536000, immutable");
  }
  await putObject(`${owner}/${name}/index.json`, JSON.stringify(indexFilenames(records, name)), "application/json", "public, max-age=60");
  const ownerPkgs = ownerPackages(records);
  await putObject(`${owner}/state.json`, JSON.stringify({ updated: new Date().toISOString(), packages: ownerPkgs }, null, 1), "application/json", "public, max-age=60");
  await mergeRootState(sql, owner, ownerPkgs);
}

// The root catalog carries every namespace; a push replaces ONLY its own
// namespace's entries, serialized by an advisory lock. (Moved verbatim from
// the legacy push route — keep its semantics.)
export async function mergeRootState(sql: Sql, owner: string, ownerPkgs: OwnerPackage[]) {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(771600)`;
    type Pkg = { namespace?: string; name?: string; versions?: { bytes?: number }[] };
    let root: { packages?: Pkg[] } = {};
    try { root = JSON.parse((await getObject("state.json")) ?? "{}"); } catch { /* first ever state */ }
    const kept = (root.packages ?? []).filter((p) => p.namespace !== owner);
    const packages = [...kept, ...(ownerPkgs as Pkg[])].sort((a, b) =>
      a.namespace === b.namespace ? (a.name ?? "").localeCompare(b.name ?? "") : (a.namespace ?? "").localeCompare(b.namespace ?? ""));
    const snapshot = {
      ...root,
      updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      package_count: packages.length,
      image_count: packages.reduce((n, p) => n + (p.versions?.length ?? 0), 0),
      total_bytes: packages.reduce((n, p) => n + (p.versions ?? []).reduce((m, v) => m + (v.bytes ?? 0), 0), 0),
      packages,
    };
    await putObject("state.json", JSON.stringify(snapshot, null, 1), "application/json", "public, max-age=30");
  });
}
