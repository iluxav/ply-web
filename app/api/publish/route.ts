// The publish: a record in, files out. Rules live in lib/records.ts.
import { NextResponse } from "next/server";
import { userForToken } from "@/lib/auth";
import { canPublish, isOwnerSegment, isReserved } from "@/lib/namespaces";
import { ready } from "@/lib/db";
import { loadRecord, mergePublish, saveRecord, validatePublishBody } from "@/lib/records";
import { writeCatalogFiles, REGISTRY } from "@/lib/catalog-files";

// Duplicated one-liner from lib/catalog-files.ts's own `basename` — the
// last path segment of a src URL, VERBATIM. Never decoded: an R2 key is
// those literal bytes, and `decodeURIComponent` throws on a lone `%`.
const basename = (u: string) => u.split("/").at(-1) ?? "";

export async function POST(req: Request) {
  const user = await userForToken((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!user) return NextResponse.json({ error: "publish with a key: Authorization: Bearer ply_…" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const v = validatePublishBody(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const rec = v.rec;
  const owner = (rec.owner ?? user.username ?? "").toLowerCase();
  if (!owner) return NextResponse.json({ error: "choose your username first at plybox.sh/account — it becomes your namespace" }, { status: 409 });
  // Before anything is built from it: the owner becomes an R2 key segment.
  if (!isOwnerSegment(owner)) return NextResponse.json({ error: "namespaces are lowercase [a-z0-9-], starting with a letter or digit" }, { status: 400 });
  if (!(await canPublish(user.id, user.username, owner))) {
    return NextResponse.json({ error: isReserved(owner) ? `\`${owner}\` is an official namespace — publishing there needs a grant` : `you cannot publish to \`${owner}\`` }, { status: 403 });
  }
  const sql = await ready();
  if (!sql) return NextResponse.json({ error: "registry accounts are not enabled here" }, { status: 503 });

  // `verified` is the server's word: only bytes it stored itself. And a src
  // that CLAIMS this registry has to be one this registry issued, under this
  // owner and name — otherwise a record could cite `ply/postgres`'s official
  // URL from someone else's namespace and inherit its trust.
  const mine = `${REGISTRY}/${owner}/${rec.name}/`;
  for (const a of rec.artifacts) {
    if (!a.src.startsWith(`${REGISTRY}/`)) continue; // published elsewhere: unverified, and not ours to police
    const file = a.src.startsWith(mine) ? a.src.slice(mine.length) : "";
    if (!file || file.includes("/")) {
      return NextResponse.json({ error: `an in-registry src must be one this registry issued under ${owner}/${rec.name}/` }, { status: 400 });
    }
    const key = a.src.slice(`${REGISTRY}/`.length);
    const [up] = await sql`SELECT sha256 FROM uploads WHERE key = ${key}`;
    if (!up) {
      // backfill: a version the legacy push stored — trust its row once,
      // and only for the SAME file (never-URL-mode, exact filename match)
      // — owner/name/version/arch alone would also match a URL-mode
      // legacy row (bytes never stored here) or a different stored file
      // under the same prefix. Skipped once `versions` is dropped: naming a
      // dropped relation fails at PARSE time, so the check is here, not in
      // a WHERE clause.
      const legacy = rec.backfill ? await legacyVersion(sql, owner, rec.name, rec.version, a.arch, basename(a.src)) : null;
      if (!legacy) return NextResponse.json({ error: `${a.src} was never uploaded here — upload it first, or point src at where the bytes live` }, { status: 400 });
      a.verified = legacy.sha256 === a.sha256;
    } else {
      if (up.sha256 !== a.sha256) return NextResponse.json({ error: `${a.src}: stored bytes have sha256 ${up.sha256.slice(0, 12)}…, the record says ${a.sha256.slice(0, 12)}…` }, { status: 400 });
      a.verified = true;
    }
  }

  const [pkg] = await sql`
    INSERT INTO packages (owner, name, type) VALUES (${owner}, ${rec.name}, ${rec.type!})
    ON CONFLICT (owner, name) DO UPDATE SET type = ${rec.type!}
    RETURNING id`;
  // load → merge → save is a read-modify-write on one row, and two arches of
  // the same version publish concurrently as a matter of routine (two CI
  // runners). Serialized per package by an advisory lock inside the
  // transaction, so the loser reads the winner's artifacts rather than
  // overwriting them.
  const merge = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(771602, ${pkg.id})`;
    const existing = await loadRecord(tx, owner, rec.name, rec.version);
    const m = mergePublish(existing ? { manifest_toml: existing.manifest_toml, artifacts: existing.artifacts } : null, rec);
    if ("error" in m) return m;
    await saveRecord(tx, { package_id: pkg.id, version: rec.version, type: rec.type!, manifest_toml: rec.manifest_toml, manifest: rec.manifest, published_by: user.id }, m.artifacts);
    if (m.status === 201) await tx`INSERT INTO events (kind, owner, name, version) VALUES ('push', ${owner}, ${rec.name}, ${rec.version})`;
    return m;
  });
  // "error" in merge (not a status===409||400 check) so TS narrows the
  // fallthrough below to the 200|201 branch — both branches of `Merge` share
  // a multi-literal `status`, which a literal-equality check alone won't
  // narrow away past the `if`.
  if ("error" in merge) return NextResponse.json({ error: merge.error, ...(merge.diff ? { diff: merge.diff } : {}) }, { status: merge.status });
  await writeCatalogFiles(sql, owner, rec.name);
  const stored = await loadRecord(sql, owner, rec.name, rec.version);
  return NextResponse.json(stored, { status: merge.status });
}

type Sql = NonNullable<Awaited<ReturnType<typeof ready>>>;

/// The pre-v3 `versions` row for exactly this file, or null once Phase 14
/// has dropped that table (a query naming a dropped relation would fail at
/// parse time, taking every backfill publish with it).
async function legacyVersion(sql: Sql, owner: string, name: string, version: string, arch: string, filename: string) {
  const [present] = await sql`SELECT to_regclass('versions') IS NOT NULL AS ok`;
  if (!present.ok) return null;
  const [row] = await sql<{ sha256: string }[]>`
    SELECT v.sha256 FROM versions v JOIN packages p ON p.id = v.package_id
    WHERE p.owner = ${owner} AND p.name = ${name} AND v.version = ${version} AND v.arch = ${arch}
      AND v.origin IS NULL AND v.filename = ${filename}`;
  return row ?? null;
}
