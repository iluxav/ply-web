// Claim a username — the one-time act that gives an account its namespace.
// Session-gated: this is a decision a person makes in a browser, not
// something a key does.
import { NextResponse } from "next/server";
import { claimUsername } from "@/lib/namespaces";
import { sessionUser } from "@/lib/session";

export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const origin = new URL(req.url).origin;
  const form = await req.formData();
  const problem = await claimUsername(user.id, String(form.get("username") ?? ""));
  const url = new URL("/account/", origin);
  if (problem) url.searchParams.set("nameerr", problem);
  return NextResponse.redirect(url, 303);
}
