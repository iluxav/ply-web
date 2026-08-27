// GitHub sends the user back with a code; the exchange (this is the one
// place the client secret exists) turns it into an identity, the identity
// into a session row, the row into a cookie.
import { NextResponse } from "next/server";
import { githubUser } from "@/lib/auth";
import { ready } from "@/lib/db";
import { createSession, cookieAttrs } from "@/lib/session";

const CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "Ov23ctE7JOHi47WnLPVR";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const expected = req.headers.get("cookie")?.match(/ply_oauth_state=([a-f0-9]+)/)?.[1];
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/account/?err=state", u.origin));
  }
  const secret = process.env.GITHUB_CLIENT_SECRET;
  if (!secret) {
    return NextResponse.redirect(new URL("/account/?err=unconfigured", u.origin));
  }
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: secret, code }),
  });
  const tokenBody = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
  const gh = tokenBody?.access_token ? await githubUser(tokenBody.access_token) : null;
  if (!gh) return NextResponse.redirect(new URL("/account/?err=github", u.origin));

  const sql = await ready();
  if (!sql) return NextResponse.redirect(new URL("/account/?err=nodb", u.origin));
  const [user] = await sql`
    INSERT INTO users (github_id, login, name) VALUES (${gh.id}, ${gh.login}, ${gh.name ?? ""})
    ON CONFLICT (github_id) DO UPDATE SET login = ${gh.login}
    RETURNING id`;
  const session = await createSession(user.id);
  const res = NextResponse.redirect(new URL("/account/", u.origin));
  if (session) res.cookies.set(cookieAttrs(session));
  res.cookies.set({ name: "ply_oauth_state", value: "", path: "/", maxAge: 0 });
  return res;
}
