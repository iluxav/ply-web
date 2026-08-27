// Registry identity: GitHub is the account system. The CLI does the
// device flow against GitHub directly (public client_id, no secret),
// then trades the GitHub token here for a ply token. We keep only the
// hash — a leaked database leaks nothing usable.
import { createHash, randomBytes } from "node:crypto";
import { ready } from "./db";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function githubUser(accessToken: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "plybox" },
  });
  if (!res.ok) return null;
  const u = (await res.json()) as { id: number; login: string; name?: string };
  return u?.id && u?.login ? u : null;
}

export async function issueToken(githubId: number, login: string, name: string) {
  const sql = await ready();
  if (!sql) return null;
  const [user] = await sql`
    INSERT INTO users (github_id, login, name) VALUES (${githubId}, ${login}, ${name})
    ON CONFLICT (github_id) DO UPDATE SET login = ${login}, name = ${name}
    RETURNING id`;
  const token = "ply_" + randomBytes(24).toString("hex");
  await sql`INSERT INTO tokens (user_id, token_hash) VALUES (${user.id}, ${hashToken(token)})`;
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
  const [u] = await sql`SELECT id, login FROM users WHERE id = ${rows[0].user_id}`;
  return u ?? null;
}
