// POST {github_token} -> {token, login}. The CLI's `ply login` endpoint.
import { NextResponse } from "next/server";
import { githubUser, issueToken, upsertGithubUser } from "@/lib/auth";
import { ready } from "@/lib/db";
import { clientIp, failures, mayMintKey, refusalHeaders } from "@/lib/limits";

export async function POST(req: Request) {
  // A rejected GitHub token costs a round trip to GitHub; the same window
  // that guards bad registry keys guards this.
  const ip = clientIp(req);
  if (!failures.allow(ip)) return NextResponse.json({ error: "too many failed logins from this address — wait a minute" }, { status: 429, headers: { "Retry-After": "60" } });
  const body = (await req.json().catch(() => null)) as { github_token?: string } | null;
  if (!body?.github_token) {
    return NextResponse.json({ error: "github_token required" }, { status: 400 });
  }
  const gh = await githubUser(body.github_token);
  if (!gh) {
    failures.noteFailure(ip);
    return NextResponse.json({ error: "github token not accepted" }, { status: 401 });
  }
  // Every login mints a key; an account cannot hold more than its tier's.
  const sql = await ready();
  const account = sql ? await upsertGithubUser(gh) : null;
  if (sql && account) {
    const [row] = await sql<{ created_at: Date }[]>`SELECT created_at FROM users WHERE id = ${account.id}`;
    const full = await mayMintKey(sql, { id: account.id, login: account.login, username: account.username, created_at: row?.created_at ?? null });
    if (full) return NextResponse.json({ error: full.error }, { status: full.status, headers: refusalHeaders(full) });
  }
  const issued = await issueToken(gh);
  if (!issued) return NextResponse.json({ error: "registry accounts are not enabled here" }, { status: 503 });
  // `login` stays the CLI's field name; its VALUE is the namespace — null
  // until the person chooses one on the site, which the CLI reports.
  return NextResponse.json({
    token: issued.token,
    login: issued.username,
    github_login: issued.login,
  });
}
