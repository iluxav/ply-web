// "Sign in with GitHub": the authorization-code flow begins. State rides
// a short-lived cookie; the callback checks it (CSRF).
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

const CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "Ov23ctE7JOHi47WnLPVR";

export async function GET(req: Request) {
  const state = randomBytes(16).toString("hex");
  const origin = new URL(req.url).origin;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", `${origin}/api/auth/callback/`);
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url);
  res.cookies.set({ name: "ply_oauth_state", value: state, httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
