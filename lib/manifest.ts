// The manifest is the record. This module is the ONLY place the server
// parses TOML: to check a CLI-supplied JSON rendering against the text, and
// to derive the listing fields state.json carries for consumers without a
// parser (the dashboard, the site). Nothing here invents data.
import { parse as parseToml } from "smol-toml";

export type Manifest = Record<string, unknown>;
export type RecordKind = "app" | "layer" | "stack";
export type Artifact = { arch: "x64" | "arm64"; src: string; sha256: string; bytes: number; verified: boolean };
export type PublishRecord = {
  owner?: string;
  name: string;
  version: string;
  type?: RecordKind;
  manifest_toml: string;
  manifest: Manifest;
  artifacts: Artifact[];
  backfill?: boolean;
};
export type StoredRecord = PublishRecord & {
  owner: string;
  type: RecordKind;
  pushed_at: string;
  published_by: string | null;
  // The `packages` row's own columns, carried alongside the record by
  // `listRecords` only. They are NOT part of the record — they are the
  // pre-v3 fallback a boot-seeded row (manifest `{}`) still needs until the
  // backfill fills its manifest in.
  description?: string;
  license?: string;
  homepage?: string;
};

export function manifestJson(toml: string): Manifest {
  return parseToml(toml) as Manifest;
}

const table = (m: Manifest, key: string): Record<string, unknown> => {
  const v = m[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function kindOf(m: Manifest): RecordKind {
  if (m.stack) return "stack";
  return table(m, "package").entrypoint ? "app" : "layer";
}

export function identityOf(m: Manifest): { owner?: string; name: string; version: string } {
  const head = m.stack ? table(m, "stack") : table(m, "package");
  const name = str(head.name);
  const version = str(head.version);
  if (!name) throw new Error("manifest has no name");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`registry versions are x.y.z (got "${version}")`);
  const owner = str(head.owner) || undefined;
  return { owner, name, version };
}

export type Derived = {
  description: string;
  license: string;
  homepage: string;
  volumes: string[];
  links: string[];
  publish?: string;
  dependencies: Record<string, string>;
  params: Record<string, unknown>;
};

export function derive(m: Manifest): Derived {
  const pkg = table(m, "package");
  const volumes = Object.values(table(m, "volumes"))
    .map((v) => str((v as Record<string, unknown>)?.path))
    .filter(Boolean);
  const linksRaw = table(m, "requests").links;
  const links = Array.isArray(linksRaw)
    ? linksRaw.map((l) => (typeof l === "string" ? l : `${str((l as Record<string, unknown>).host)}:${str((l as Record<string, unknown>).at)}`))
    : [];
  const ports = Object.values(table(m, "ports"));
  const publish = ports.length === 1 && typeof ports[0] === "number" ? `internal:${ports[0]}` : undefined;
  const dependencies: Record<string, string> = {};
  for (const [k, v] of Object.entries(table(m, "dependencies"))) {
    dependencies[k] = typeof v === "string" ? v : str((v as Record<string, unknown>)?.version);
  }
  return {
    description: str(pkg.description),
    license: str(pkg.license),
    homepage: str(pkg.homepage),
    volumes,
    links,
    ...(publish ? { publish } : {}),
    dependencies,
    params: table(m, "params"),
  };
}

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
  : v instanceof Date ? v.toISOString()
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
  : v;

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
