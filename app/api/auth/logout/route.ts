import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/site";
import { destroySession, clearedCookie } from "@/lib/session";

export async function POST() {
  await destroySession();
  const res = NextResponse.redirect(new URL("/account/", siteOrigin()), 303);
  res.cookies.set(clearedCookie());
  return res;
}
