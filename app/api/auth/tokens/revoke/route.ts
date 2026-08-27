// Revoke a CLI token — the row dies, the token stops working mid-flight.
import { NextResponse } from "next/server";
import { ready } from "@/lib/db";
import { sessionUser } from "@/lib/session";

export async function POST(req: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const form = await req.formData();
  const id = parseInt(String(form.get("id") ?? ""), 10);
  const sql = await ready();
  if (sql && Number.isFinite(id)) {
    await sql`DELETE FROM tokens WHERE id = ${id} AND user_id = ${user.id}`;
  }
  return NextResponse.redirect(new URL("/account/", new URL(req.url).origin), 303);
}
