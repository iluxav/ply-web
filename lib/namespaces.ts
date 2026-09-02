// Who may publish where.
//
// Your GitHub login IS your namespace — that needs no bookkeeping and no
// claim. Everything else (the official `ply` and `apps` shelves, a shared
// org name) is a row in `namespace_grants`: explicit, revocable, and
// visible on the account page.
//
// The reserved names are never implicitly yours, even if your GitHub login
// happens to be one of them — otherwise registering the right account would
// hand someone the official shelf.
//
// There are exactly two, and they are the two official shelves: `ply` (the
// layers ply itself builds on) and `apps` (the ready-to-run ones). Every
// other name is a person's to take, first come. A longer list of "words we
// might want later" only looked like caution: each name on it became a grant
// row on every admin login, and each grant row silently made that name
// unclaimable by anyone.
import { ready } from "./db";

export const RESERVED = new Set(["ply", "apps"]);

export function isReserved(namespace: string) {
  return RESERVED.has(namespace.toLowerCase());
}

// The namespace grammar, and the shape of an R2 path segment: lowercase,
// starts alphanumeric, no trailing dash, 2–39 characters.
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,37}[a-z0-9]$/;

/// The grammar an owner must satisfy to become an R2 key segment: the
/// namespace part of `{owner}/{name}/{file}`. Deliberately looser than
/// `NAME_RE` (a grant may hold a two-letter official shelf, and old logins
/// predate the username rules) but strict about what would escape a key:
/// no `/`, no `.`, no uppercase, never empty. Checked on every route that
/// builds a key from a resolved owner.
export const isOwnerSegment = (owner: string) => /^[a-z0-9][a-z0-9-]*$/.test(owner);

/// Why this username cannot be claimed, or null if it can.
export async function usernameProblem(raw: string) {
  const name = raw.trim().toLowerCase();
  if (!name) return "pick a username — it becomes your namespace";
  if (!NAME_RE.test(name)) {
    return "2–39 characters: lowercase letters, digits and dashes, starting and ending with a letter or digit";
  }
  if (isReserved(name)) return `\`${name}\` is reserved`;
  const sql = await ready();
  if (!sql) return "the registry database is unavailable";
  const [taken] = await sql`SELECT 1 FROM users WHERE username = ${name}`;
  if (taken) return `\`${name}\` is taken`;
  const [granted] = await sql`SELECT 1 FROM namespace_grants WHERE namespace = ${name}`;
  if (granted) return `\`${name}\` is taken`;
  return null;
}

/// Claim a username, once. It is the person's namespace from then on:
/// published packages are filed under it, so it never changes hands and
/// never moves — a GitHub rename leaves it exactly where it is.
export async function claimUsername(userId: number, raw: string) {
  const name = raw.trim().toLowerCase();
  const problem = await usernameProblem(name);
  if (problem) return problem;
  const sql = await ready();
  if (!sql) return "the registry database is unavailable";
  // WHERE username IS NULL: claiming is a one-time act, and two racing
  // requests cannot both win it.
  const rows = await sql`
    UPDATE users SET username = ${name} WHERE id = ${userId} AND username IS NULL
    RETURNING id`;
  if (rows.length === 0) return "you already have a username";
  return null;
}

/// What to put in the "choose a username" box: their GitHub handle, else
/// the local part of their email, sanitized to the grammar.
export function suggestUsername(login: string | null, email: string | null) {
  const raw = (login ?? email?.split("@")[0] ?? "").toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 39);
  return NAME_RE.test(cleaned) && !isReserved(cleaned) ? cleaned : "";
}

/// May this user publish under `namespace`?
export async function canPublish(userId: number, username: string | null, namespace: string) {
  const ns = namespace.toLowerCase();
  if (username && ns === username.toLowerCase() && !isReserved(ns)) return true;
  const sql = await ready();
  if (!sql) return false;
  const rows = await sql`
    SELECT 1 FROM namespace_grants WHERE namespace = ${ns} AND user_id = ${userId}`;
  return rows.length > 0;
}

/// Everything this user can publish under, their own username first. An
/// account that has not chosen one yet publishes nowhere.
export async function namespacesFor(userId: number, username: string | null) {
  const own = username?.toLowerCase() ?? null;
  const sql = await ready();
  if (!sql) return own ? [own] : [];
  const rows = await sql`
    SELECT namespace FROM namespace_grants WHERE user_id = ${userId} ORDER BY namespace`;
  const granted = rows.map((r) => String(r.namespace)).filter((n) => n !== own);
  return own && !isReserved(own) ? [own, ...granted] : granted;
}

/// Grant the official shelves to the logins named by PLY_ADMIN_LOGINS
/// (comma-separated). Runs on every login, so an operator configures the
/// deployment rather than hand-writing SQL, and revoking is deleting the
/// row plus the env entry.
export async function syncAdminGrants(userId: number, identity: string | null) {
  const admins = (process.env.PLY_ADMIN_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!identity || !admins.includes(identity.toLowerCase())) return;
  const sql = await ready();
  if (!sql) return;
  for (const ns of RESERVED) {
    await sql`
      INSERT INTO namespace_grants (namespace, user_id) VALUES (${ns}, ${userId})
      ON CONFLICT DO NOTHING`;
  }
}
