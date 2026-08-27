import { NextResponse } from "next/server";
import { destroySession, clearedCookie } from "@/lib/session";

export async function POST(req: Request) {
  await destroySession();
  const res = NextResponse.redirect(new URL("/account/", new URL(req.url).origin), 303);
  res.cookies.set(clearedCookie());
  return res;
}
