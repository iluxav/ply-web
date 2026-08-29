// POST {github_token} -> {token, login}. The CLI's `ply login` endpoint.
import { NextResponse } from "next/server";
import { githubUser, issueToken } from "@/lib/auth";


export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { github_token?: string } | null;
  if (!body?.github_token) {
    return NextResponse.json({ error: "github_token required" }, { status: 400 });
  }
  const gh = await githubUser(body.github_token);
  if (!gh) return NextResponse.json({ error: "github token not accepted" }, { status: 401 });
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
