// CLI keys: mint and list. Two callers, one route —
//
//   POST  (session cookie)      the account page's "generate a key" form
//   POST  Authorization: Bearer `ply key new` from a machine already holding one
//   GET   Authorization: Bearer `ply key ls`
//
// A key is shown exactly once: only its sha256 is stored. CI runners can
// never do the device flow, so minting a key from an existing key (or from
// the web) is the only way a pipeline gets to publish.
import { NextResponse } from "next/server";
import { mintToken, userForToken } from "@/lib/auth";
import { ready } from "@/lib/db";
import { sessionUser } from "@/lib/session";

// The caller: a browser session, or a bearer key. Either proves the same
// account; neither can act for another one.
async function caller(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer) return userForToken(bearer);
  return sessionUser();
}

export async function POST(req: Request) {
  const user = await caller(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  // the web form posts multipart; the CLI posts JSON
  let note = "";
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("json")) {
    const body = (await req.json().catch(() => null)) as { note?: string } | null;
    note = String(body?.note ?? "");
  } else {
    const form = await req.formData().catch(() => null);
    note = String(form?.get("note") ?? "");
  }

  const token = await mintToken(user.id, note);
  if (!token) {
    return NextResponse.json({ error: "registry accounts are not enabled here" }, { status: 503 });
  }
  if (type.includes("json")) {
    return NextResponse.json({ token, login: user.username });
  }
  // The web lane shows the key once, in the URL fragment of the redirect —
  // a fragment never reaches the server or the access log.
  const origin = new URL(req.url).origin;
  return NextResponse.redirect(new URL(`/account/#key=${token}`, origin), 303);
}

export async function GET(req: Request) {
  const user = await caller(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const sql = await ready();
  if (!sql) return NextResponse.json({ keys: [] });
  const keys = await sql`
    SELECT id, note, created_at, last_used_at FROM tokens
    WHERE user_id = ${user.id} ORDER BY id`;
  return NextResponse.json({ keys });
}
