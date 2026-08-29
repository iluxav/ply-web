// Revoke a CLI key — the row dies, the key stops working mid-flight.
// Same two callers as minting: the account page's form (session, redirect)
// and `ply key rm <id>` (bearer, JSON).
import { NextResponse } from "next/server";
import { userForToken } from "@/lib/auth";
import { ready } from "@/lib/db";
import { sessionUser } from "@/lib/session";

export async function POST(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const user = bearer ? await userForToken(bearer) : await sessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const type = req.headers.get("content-type") ?? "";
  let id = NaN;
  if (type.includes("json")) {
    const body = (await req.json().catch(() => null)) as { id?: number } | null;
    id = parseInt(String(body?.id ?? ""), 10);
  } else {
    const form = await req.formData();
    id = parseInt(String(form.get("id") ?? ""), 10);
  }

  const sql = await ready();
  if (sql && Number.isFinite(id)) {
    await sql`DELETE FROM tokens WHERE id = ${id} AND user_id = ${user.id}`;
  }
  if (type.includes("json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL("/account/", new URL(req.url).origin), 303);
}
