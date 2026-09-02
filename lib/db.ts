// The registry's control-plane database. Connection details arrive the ply
// way: the discovery env (`after = ["postgres"]` injects POSTGRES_HOST/
// PORT) plus the shared password from the stack's env_file. No DATABASE_URL
// assembly required — though one is honored if present.
//
// Build-time safety: next build prerenders pages with no database around.
// Everything here is lazy — nothing connects until a request needs it —
// and callers treat `null` as "registry runs static-only".
import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null | undefined;
let migrated = false;

export function db() {
  if (sql !== undefined) return sql;
  const host = process.env.POSTGRES_HOST;
  const password = process.env.POSTGRES_PASSWORD;
  if (process.env.DATABASE_URL) {
    sql = postgres(process.env.DATABASE_URL, { max: 4 });
  } else if (host && password) {
    sql = postgres({
      host,
      port: parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
      database: process.env.POSTGRES_DB ?? "plybox",
      username: process.env.POSTGRES_USER ?? "postgres",
      password,
      max: 4,
    });
  } else {
    sql = null; // no database wired: the site serves, registry stays static
  }
  return sql;
}

/// Anything that runs a query: the pooled client, or a transaction handle
/// from `sql.begin`. postgres.js's `TransactionSql` is NOT a subtype of
/// `Sql` (it has no `.begin`/`.reserve`), so every helper meant to work
/// inside a transaction has to name this instead.
export type Queryable = postgres.ISql;

// Idempotent, run-once-per-process. CREATE IF NOT EXISTS keeps restarts
// boring; real migrations get a version table the day they need one.
export async function ready() {
  const s = db();
  if (!s) return null;
  if (!migrated) {
    // One connection, one lock, one migration. `pg_advisory_lock` is
    // SESSION-scoped — taken on whichever pooled connection served that one
    // statement, which the next statement need not get — so the lock is
    // taken as `pg_advisory_xact_lock` inside `begin`: same connection for
    // every statement below, released on commit OR on error, with no unlock
    // to forget. Two cold starts (or two concurrent first requests) then
    // queue instead of racing on the same CREATEs and the same seeds.
    await s.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(771601)`;
      await migrate(tx);
    });
    migrated = true;
  }
  return s;
}

/// The whole schema. Runs under the migration lock, on one connection.
async function migrate(s: Queryable) {
    await s`
      CREATE TABLE IF NOT EXISTS users (
        id         serial PRIMARY KEY,
        github_id  bigint UNIQUE NOT NULL,
        login      text   UNIQUE NOT NULL,
        name       text   NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    await s`
      CREATE TABLE IF NOT EXISTS tokens (
        id           serial PRIMARY KEY,
        user_id      int NOT NULL REFERENCES users(id),
        token_hash   text UNIQUE NOT NULL,
        note         text NOT NULL DEFAULT '',
        created_at   timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz
      )`;
    await s`
      CREATE TABLE IF NOT EXISTS packages (
        id          serial PRIMARY KEY,
        owner       text NOT NULL,
        name        text NOT NULL,
        type        text NOT NULL DEFAULT 'app',
        description text NOT NULL DEFAULT '',
        license     text NOT NULL DEFAULT '',
        homepage    text NOT NULL DEFAULT '',
        origin      text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (owner, name)
      )`;
    await s`
      CREATE TABLE IF NOT EXISTS versions (
        id         serial PRIMARY KEY,
        package_id int NOT NULL REFERENCES packages(id),
        version    text NOT NULL,
        arch       text NOT NULL,
        filename   text NOT NULL,
        bytes      bigint NOT NULL DEFAULT 0,
        sha256     text NOT NULL,
        origin     text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (package_id, version, arch)
      )`;
    // v2 catalog metadata — derived from the image on the client at push time
    // (client-derives, server-stores) and echoed verbatim into state.json.
    await s`ALTER TABLE versions ADD COLUMN IF NOT EXISTS volumes jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await s`ALTER TABLE versions ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await s`ALTER TABLE versions ADD COLUMN IF NOT EXISTS dependencies jsonb NOT NULL DEFAULT '[]'::jsonb`;
    // For a stack version: the run sequence (mirrors the pushed `[[app]]`).
    await s`ALTER TABLE versions ADD COLUMN IF NOT EXISTS apps jsonb NOT NULL DEFAULT '[]'::jsonb`;
    // Identity is the verified email, not the GitHub handle: handles get
    // renamed (and the freed name re-registered by someone else), and a
    // second provider — Google, say — must land on the SAME account. The
    // namespace is a `username` the person CHOOSES once and keeps, so
    // renaming on GitHub never moves, breaks, or hands over a namespace.
    await s`ALTER TABLE users ADD COLUMN IF NOT EXISTS email text`;
    await s`ALTER TABLE users ADD COLUMN IF NOT EXISTS username text`;
    await s`ALTER TABLE users ALTER COLUMN github_id DROP NOT NULL`;
    await s`
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_key
      ON users (lower(email)) WHERE email IS NOT NULL`;
    await s`
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
      ON users (username) WHERE username IS NOT NULL`;
    // Everyone who published before this existed keeps the namespace their
    // packages are already filed under.
    await s`UPDATE users SET username = lower(login) WHERE username IS NULL`;

    // Namespaces beyond your own login: the official `ply`/`apps` shelves,
    // or a shared org name. Your own login needs no row — it is yours by
    // construction; a grant is how anything ELSE becomes publishable.
    await s`
      CREATE TABLE IF NOT EXISTS namespace_grants (
        namespace  text NOT NULL,
        user_id    int  NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (namespace, user_id)
      )`;
    await s`
      CREATE TABLE IF NOT EXISTS sessions (
        id         text PRIMARY KEY,
        user_id    int NOT NULL REFERENCES users(id),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    await s`
      CREATE TABLE IF NOT EXISTS events (
        id    bigserial PRIMARY KEY,
        kind  text NOT NULL,
        owner text NOT NULL DEFAULT '',
        name  text NOT NULL DEFAULT '',
        version text NOT NULL DEFAULT '',
        at    timestamptz NOT NULL DEFAULT now()
      )`;
    // v3: the manifest IS the record. One row per version; artifacts are a
    // jsonb list; every listing field is derived from `manifest` at write time.
    await s`
      CREATE TABLE IF NOT EXISTS records (
        id            serial PRIMARY KEY,
        package_id    int NOT NULL REFERENCES packages(id),
        version       text NOT NULL,
        type          text NOT NULL,
        manifest_toml text NOT NULL,
        manifest      jsonb NOT NULL,
        artifacts     jsonb NOT NULL DEFAULT '[]'::jsonb,
        pushed_at     timestamptz NOT NULL DEFAULT now(),
        published_by  int REFERENCES users(id),
        UNIQUE (package_id, version)
      )`;
    await s`CREATE INDEX IF NOT EXISTS records_manifest_gin ON records USING gin (manifest)`;
    // Bytes the registry stored itself: the only srcs a publish may mark verified.
    await s`
      CREATE TABLE IF NOT EXISTS uploads (
        key        text PRIMARY KEY,
        sha256     text NOT NULL,
        bytes      bigint NOT NULL,
        user_id    int NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`;

    // v3 bridge, one-time backfill at boot: state.json is now built from
    // `records` alone, so without this an owner's pre-v3 packages would
    // vanish from their catalog the moment this deploys — before anyone has
    // re-pushed a single version, and before the separate backfill script
    // has run. Seed a manifest-less `records` row (and the matching
    // `uploads` row) for every legacy `versions` entry that doesn't already
    // have one. Both inserts are guarded by NOT EXISTS, so this is a no-op
    // once seeded, or once every version has a real v3 record.
    await s`ALTER TABLE uploads ALTER COLUMN user_id DROP NOT NULL`; // seeded rows have no user
    // …and only while `versions` still exists. The bridge is temporary: once
    // every version has a real record, Phase 14 drops that table, and a
    // statement that so much as NAMES a dropped relation fails when the
    // server PARSES it — a `WHERE to_regclass('versions') IS NOT NULL` would
    // not save it, because relation resolution happens before any WHERE is
    // evaluated. So the check is here, in TypeScript, and the seeds are
    // skipped entirely. Without this, `DROP TABLE versions` would brick
    // every request the next cold start served.
    const [legacy] = await s`SELECT to_regclass('versions') IS NOT NULL AS present`;
    if (legacy.present) {
      await s`
        INSERT INTO uploads (key, sha256, bytes, user_id)
        SELECT p.owner || '/' || p.name || '/' || v.filename, v.sha256, v.bytes, NULL
        FROM versions v JOIN packages p ON p.id = v.package_id
        WHERE v.origin IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM uploads u WHERE u.key = p.owner || '/' || p.name || '/' || v.filename
          )
        ON CONFLICT DO NOTHING`;
      await s`
        INSERT INTO records (package_id, version, type, manifest_toml, manifest, artifacts, pushed_at, published_by)
        SELECT
          v.package_id, v.version, p.type, '', '{}'::jsonb,
          CASE WHEN p.type = 'stack' THEN '[]'::jsonb ELSE jsonb_agg(jsonb_build_object(
            'arch', v.arch,
            'src', COALESCE(v.origin, 'https://registry.plybox.sh/' || p.owner || '/' || p.name || '/' || v.filename),
            'sha256', v.sha256,
            'bytes', v.bytes,
            'verified', v.origin IS NULL
          )) END,
          min(v.created_at), NULL
        FROM versions v JOIN packages p ON p.id = v.package_id
        WHERE NOT EXISTS (
          SELECT 1 FROM records r WHERE r.package_id = v.package_id AND r.version = v.version
        )
        GROUP BY v.package_id, v.version, p.type, p.owner, p.name
        ON CONFLICT DO NOTHING`;
    }
}
