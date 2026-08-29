// "Sign in with GitHub": the authorization-code flow begins. State rides
// a short-lived cookie; the callback checks it (CSRF).
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

const CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "Ov23ctE7JOHi47WnLPVR";
// The edge terminates TLS, so the request itself claims http:// — the
// redirect_uri must be the canonical public origin, never derived.
const ORIGIN = process.env.PLY_SITE_ORIGIN ?? "https://plybox.sh";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", `${ORIGIN}/api/auth/callback/`);
  url.searchParams.set("state", state);
  // the verified primary email is the account identity — a GitHub handle
  // can be renamed and re-registered, an email cannot be silently taken
  url.searchParams.set("scope", "user:email");
  const res = NextResponse.redirect(url);
  res.cookies.set({ name: "ply_oauth_state", value: state, httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
