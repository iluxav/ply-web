// GET Authorization: Bearer ply_… -> {login}. What a key alone can answer:
// a CI runner holds a key and no credentials file, and still needs to know
// (and print) the namespace it publishes to.
import { NextResponse } from "next/server";
import { userForToken } from "@/lib/auth";
import { namespacesFor } from "@/lib/namespaces";

export async function GET(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const user = bearer ? await userForToken(bearer) : null;
  if (!user) return NextResponse.json({ error: "key not accepted" }, { status: 401 });
  return NextResponse.json({
    login: user.username,
    github_login: user.login,
    namespaces: await namespacesFor(user.id, user.username),
  });
}
