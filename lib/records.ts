// One row per (owner, name, version): the manifest verbatim, its JSON, and
// the artifacts. Publish rules are pure functions so they can be tested
// without a database; the SQL wrappers below are thin.
import { identityOf, kindOf, manifestJson, sameJson, type Artifact, type PublishRecord, type RecordKind, type StoredRecord } from "./manifest";

export type Existing = { manifest_toml: string; artifacts: Artifact[] } | null;
export type Merge =
  | { status: 201 | 200; artifacts: Artifact[] }
  | { status: 409 | 400; error: string; diff?: string };

export function firstDiff(a: string, b: string): string {
  const la = a.split("\n"), lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return `line ${i + 1}: ${la[i] ?? "<end>"} | ${lb[i] ?? "<end>"}`;
  }
  return "";
}

export function mergePublish(existing: Existing, incoming: { manifest_toml: string; artifacts: Artifact[] }): Merge {
  const seen = new Set<string>();
  for (const a of incoming.artifacts) {
    if (seen.has(a.arch)) return { status: 400, error: `two artifacts for ${a.arch} in one publish` };
    seen.add(a.arch);
  }
  if (!existing) return { status: 201, artifacts: incoming.artifacts };
  // A seeded/legacy record with manifest_toml === "" has no manifest to
  // compare against — "manifest unknown", not "manifest fixed". The first
  // real publish for that version supplies it without a 409.
  if (existing.manifest_toml !== "" && existing.manifest_toml !== incoming.manifest_toml) {
    return {
      status: 409,
      error: "this version is already published with a different manifest — one version, one manifest; bump the version",
      diff: firstDiff(existing.manifest_toml, incoming.manifest_toml),
    };
  }
  const merged = [...existing.artifacts];
  let added = 0;
  for (const a of incoming.artifacts) {
    const have = merged.find((e) => e.arch === a.arch);
    if (!have) { merged.push(a); added++; continue; }
    if (have.sha256 !== a.sha256) {
      return { status: 409, error: `${a.arch} is already published with different bytes — the registry is append-only; bump the version` };
    }
  }
  return { status: added ? 201 : 200, artifacts: merged };
}

const SHA = /^[0-9a-f]{64}$/;
export function validatePublishBody(body: unknown): { ok: true; rec: PublishRecord } | { ok: false; error: string } {
  const b = body as Partial<PublishRecord> | null;
  if (!b || typeof b !== "object") return { ok: false, error: "expected a JSON record" };
  if (typeof b.manifest_toml !== "string" || !b.manifest_toml.trim()) return { ok: false, error: "manifest_toml is required" };
  let parsed;
  try { parsed = manifestJson(b.manifest_toml); } catch (e) { return { ok: false, error: `manifest_toml: ${(e as Error).message}` }; }
  if (!sameJson(parsed, b.manifest)) return { ok: false, error: "manifest does not match manifest_toml" };
  let id;
  try { id = identityOf(parsed); } catch (e) { return { ok: false, error: (e as Error).message }; }
  if (b.name !== id.name || b.version !== id.version) return { ok: false, error: `record names ${b.name}@${b.version} but the manifest says ${id.name}@${id.version}` };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id.name)) return { ok: false, error: "package names are lowercase [a-z0-9-], starting with a letter or digit" };
  const artifacts: Artifact[] = [];
  for (const a of Array.isArray(b.artifacts) ? b.artifacts : []) {
    const x = a as Partial<Artifact>;
    if (x.arch !== "x64" && x.arch !== "arm64") return { ok: false, error: "artifact arch must be x64 or arm64" };
    if (typeof x.src !== "string" || !x.src.startsWith("https://")) return { ok: false, error: "artifact src must be an https URL" };
    // Parseable, not merely https-prefixed: the src's last segment becomes
    // an R2 key and is compared against one, and a src the URL parser
    // refuses (a stray `%`, a space) is a typo worth a 400 at the door
    // rather than a throw deep in the publish, after the record was saved.
    try { new URL(x.src); } catch { return { ok: false, error: "artifact src must be a valid https URL" }; }
    if (typeof x.sha256 !== "string" || !SHA.test(x.sha256)) return { ok: false, error: "artifact sha256 must be 64 hex chars" };
    if (typeof x.bytes !== "number" || x.bytes < 0) return { ok: false, error: "artifact bytes must be a non-negative number" };
    artifacts.push({ arch: x.arch, src: x.src, sha256: x.sha256, bytes: x.bytes, verified: false }); // the server decides `verified`
  }
  return { ok: true, rec: { owner: id.owner ?? (typeof b.owner === "string" ? b.owner : undefined), name: id.name, version: id.version, type: kindOf(parsed), manifest_toml: b.manifest_toml, manifest: parsed, artifacts, backfill: b.backfill === true } };
}

// --- storage ---------------------------------------------------------------
// `sql` is the postgres.js client from lib/db.ts `ready()` — or the
// transaction handle the publish route wraps a load→merge→save in, which is
// why this is `Queryable` (a TransactionSql is not a `Sql`).
type Sql = import("./db").Queryable;

type Row = {
  id: number; package_id: number; owner: string; name: string; version: string; type: RecordKind;
  manifest_toml: string; manifest: Record<string, unknown>; artifacts: Artifact[];
  pushed_at: Date; published_by: string | null;
  // selected by `listRecords` only — the catalog's rollout-window fallback
  description?: string; license?: string; homepage?: string;
};

const fromRow = (r: Row): StoredRecord & { id: number; package_id: number } => ({
  id: r.id, package_id: r.package_id, owner: r.owner, name: r.name, version: r.version, type: r.type,
  manifest_toml: r.manifest_toml, manifest: r.manifest, artifacts: r.artifacts,
  pushed_at: r.pushed_at.toISOString(), published_by: r.published_by,
  // Only where they were selected: a publish response stays the record and
  // nothing else.
  ...(r.description !== undefined
    ? { description: r.description, license: r.license ?? "", homepage: r.homepage ?? "" }
    : {}),
});

export async function loadRecord(sql: Sql, owner: string, name: string, version: string) {
  const rows = await sql<Row[]>`
    SELECT r.id, r.package_id, p.owner, p.name, r.version, r.type, r.manifest_toml, r.manifest, r.artifacts,
           r.pushed_at, u.username AS published_by
    FROM records r JOIN packages p ON p.id = r.package_id LEFT JOIN users u ON u.id = r.published_by
    WHERE p.owner = ${owner} AND p.name = ${name} AND r.version = ${version}`;
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function saveRecord(
  sql: Sql,
  rec: { package_id: number; version: string; type: RecordKind; manifest_toml: string; manifest: Record<string, unknown>; published_by: number | null },
  artifacts: Artifact[],
) {
  // A prior manifest-less record (seeded at boot, or from the legacy image
  // bridge) is "manifest unknown", not "manifest fixed" — this publish's
  // manifest/type fill it in. A record that already carries a real manifest
  // keeps it: only `artifacts` ever changes once a manifest is on file.
  await sql`
    INSERT INTO records (package_id, version, type, manifest_toml, manifest, artifacts, published_by)
    VALUES (${rec.package_id}, ${rec.version}, ${rec.type}, ${rec.manifest_toml}, ${sql.json(rec.manifest as Parameters<typeof sql.json>[0])}, ${sql.json(artifacts)}, ${rec.published_by})
    ON CONFLICT (package_id, version) DO UPDATE SET
      artifacts = EXCLUDED.artifacts,
      manifest_toml = CASE WHEN records.manifest_toml = '' THEN EXCLUDED.manifest_toml ELSE records.manifest_toml END,
      manifest = CASE WHEN records.manifest_toml = '' THEN EXCLUDED.manifest ELSE records.manifest END,
      type = CASE WHEN records.manifest_toml = '' THEN EXCLUDED.type ELSE records.type END`;
}

export async function listRecords(sql: Sql, owner: string): Promise<StoredRecord[]> {
  // p.description/license/homepage ride along for `ownerPackages`: while a
  // seeded record's manifest is still `{}`, those columns are the only copy
  // of the listing fields that exists.
  const rows = await sql<Row[]>`
    SELECT r.id, r.package_id, p.owner, p.name, r.version, r.type, r.manifest_toml, r.manifest, r.artifacts,
           r.pushed_at, u.username AS published_by, p.description, p.license, p.homepage
    FROM records r JOIN packages p ON p.id = r.package_id LEFT JOIN users u ON u.id = r.published_by
    WHERE p.owner = ${owner}
    ORDER BY p.name, r.pushed_at`;
  return rows.map(fromRow);
}
