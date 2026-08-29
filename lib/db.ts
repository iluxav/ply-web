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

// Idempotent, run-once-per-process. CREATE IF NOT EXISTS keeps restarts
// boring; real migrations get a version table the day they need one.
export async function ready() {
  const s = db();
  if (!s) return null;
  if (!migrated) {
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
    migrated = true;
  }
  return s;
}
