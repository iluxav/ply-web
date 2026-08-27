// Live registry numbers for the /registry page — graceful zeroes when the
// database isn't wired (dev boxes, static mirrors).
import { NextResponse } from "next/server";
import { ready } from "@/lib/db";


export async function GET(req: Request) {
  void req.headers; // request-bound: never prerendered into a static zero
  try {
    const sql = await ready();
    if (!sql) return NextResponse.json({ enabled: false });
    const [row] = await sql`
      SELECT
        (SELECT count(*) FROM packages)                                   AS packages,
        (SELECT count(*) FROM versions)                                   AS versions,
        (SELECT count(*) FROM users)                                      AS publishers,
        (SELECT count(*) FROM events WHERE kind = 'push' AND at > now() - interval '7 days') AS pushes_week`;
    return NextResponse.json({ enabled: true, ...row });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
