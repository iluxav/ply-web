// Browser sessions for the account pages. DB-backed and opaque: the
// cookie holds a random id, the row holds who it is — revocation is a
// DELETE, and there is no signing key to rotate or leak.
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { ready } from "./db";

const COOKIE = "ply_session";
const TTL_DAYS = 30;

export async function createSession(userId: number) {
  const sql = await ready();
  if (!sql) return null;
  const id = randomBytes(24).toString("hex");
  await sql`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${id}, ${userId}, now() + make_interval(days => ${TTL_DAYS}))`;
  return id;
}

export async function sessionUser() {
  const sql = await ready();
  if (!sql) return null;
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;
  const rows = await sql`
    SELECT u.id, u.login, u.name, u.username, u.email FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${id} AND s.expires_at > now()`;
  return (
    (rows[0] as {
      id: number;
      login: string | null;
      name: string;
      username: string | null;
      email: string | null;
    }) ?? null
  );
}

export async function destroySession() {
  const sql = await ready();
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (sql && id) await sql`DELETE FROM sessions WHERE id = ${id}`;
}

export function cookieAttrs(id: string) {
  return {
    name: COOKIE,
    value: id,
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: TTL_DAYS * 24 * 3600,
  };
}

export function clearedCookie() {
  return { name: COOKIE, value: "", httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 0 };
}
