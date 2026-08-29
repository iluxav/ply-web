// Registry identity: GitHub is the account system. The CLI does the
// device flow against GitHub directly (public client_id, no secret),
// then trades the GitHub token here for a ply token. We keep only the
// hash — a leaked database leaks nothing usable.
import { createHash, randomBytes } from "node:crypto";
import { ready } from "./db";
import { syncAdminGrants } from "./namespaces";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function githubUser(accessToken: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "plybox" },
  });
  if (!res.ok) return null;
  const u = (await res.json()) as { id: number; login: string; name?: string; email?: string };
  if (!u?.id || !u?.login) return null;
  return { ...u, email: await githubEmail(accessToken, u.email) };
}

/// The primary VERIFIED email, which is what identity may be keyed on: an
/// unverified address proves nothing and would let anyone claim someone
/// else's account by signing up elsewhere with their address. Needs the
/// `user:email` scope; without it (or with no verified address) we get
/// null and the account simply stays GitHub-only.
async function githubEmail(accessToken: string, fallback?: string) {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "plybox" },
  });
  if (res.ok) {
    const list = (await res.json()) as { email: string; primary: boolean; verified: boolean }[];
    const primary = list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified);
    if (primary) return primary.email.toLowerCase();
  }
  // /user only exposes `email` when the profile makes it public, and a
  // public address on GitHub is always a verified one.
  return fallback ? fallback.toLowerCase() : null;
}

/// Find-or-create the account behind a sign-in, and return it.
///
/// Matching order is deliberate: the provider id first (the same GitHub
/// account, even if its handle or email changed), then the VERIFIED email
/// (the same person arriving through a second provider). A rename updates
/// `login`; it never touches `username`, which is the namespace.
export async function upsertGithubUser(gh: {
  id: number;
  login: string;
  name?: string;
  email: string | null;
}) {
  const sql = await ready();
  if (!sql) return null;
  const name = gh.name ?? "";

  const [byProvider] = await sql`SELECT id FROM users WHERE github_id = ${gh.id}`;
  const [byEmail] = gh.email
    ? await sql`SELECT id FROM users WHERE lower(email) = ${gh.email} AND github_id IS NULL`
    : [];
  const existing = byProvider ?? byEmail;

  const [user] = existing
    ? await sql`
        UPDATE users
        SET login = ${gh.login}, name = ${name},
            github_id = ${gh.id},
            email = COALESCE(${gh.email}, email)
        WHERE id = ${existing.id}
        RETURNING id, login, username`
    : await sql`
        INSERT INTO users (github_id, login, name, email)
        VALUES (${gh.id}, ${gh.login}, ${name}, ${gh.email})
        RETURNING id, login, username`;

  await syncAdminGrants(user.id, user.username ?? gh.login);
  return user as { id: number; login: string; username: string | null };
}

export async function issueToken(gh: {
  id: number;
  login: string;
  name?: string;
  email: string | null;
}) {
  const user = await upsertGithubUser(gh);
  if (!user) return null;
  const token = await mintToken(user.id, "");
  return token ? { token, username: user.username, login: user.login } : null;
}

// A second (third, tenth) key for an account that already exists: what CI
// uses, since a runner can never do the device flow. Returned once and
// never again — only the hash is stored.
export async function mintToken(userId: number, note: string) {
  const sql = await ready();
  if (!sql) return null;
  const token = "ply_" + randomBytes(24).toString("hex");
  await sql`
    INSERT INTO tokens (user_id, token_hash, note)
    VALUES (${userId}, ${hashToken(token)}, ${note.slice(0, 200)})`;
  return token;
}

export async function userForToken(token: string) {
  const sql = await ready();
  if (!sql || !token.startsWith("ply_")) return null;
  const rows = await sql`
    UPDATE tokens SET last_used_at = now()
    WHERE token_hash = ${hashToken(token)}
    RETURNING user_id`;
  if (rows.length === 0) return null;
  const [u] = await sql`SELECT id, login, username FROM users WHERE id = ${rows[0].user_id}`;
  return (u as { id: number; login: string; username: string | null }) ?? null;
}
