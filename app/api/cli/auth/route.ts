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
  const token = await issueToken(gh.id, gh.login, gh.name ?? "");
  if (!token) return NextResponse.json({ error: "registry accounts are not enabled here" }, { status: 503 });
  return NextResponse.json({ token, login: gh.login });
}
