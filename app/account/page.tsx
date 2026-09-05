import type { Metadata } from "next";
import { Suspense } from "react";
import { ready } from "@/lib/db";
import { sessionUser } from "@/lib/session";
import { pageMetadata } from "@/lib/site";
import { namespacesFor, suggestUsername } from "@/lib/namespaces";
import { AccountDashboard, ClaimUsername, SignedOutAccount } from "@/components/AccountViews";
import styles from "@/components/Account.module.css";

export const metadata: Metadata = pageMetadata({
  title: "Account",
  description: "Your ply registry account: packages, CLI tokens, publishing.",
  path: "/account/",
});

export default function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; nameerr?: string }>;
}) {
  return (
    <Suspense fallback={<main className={styles.page} aria-busy="true"><p className={styles.eyebrow}>Account / publishing workspace</p><p className={styles.loading} role="status">Loading your account…</p></main>}>
      <AccountBody searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountBody({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; nameerr?: string }>;
}) {
  const { err, nameerr } = await searchParams;
  const user = await sessionUser();

  if (!user) return <SignedOutAccount error={err} />;
  if (!user.username) {
    return <ClaimUsername suggestion={suggestUsername(user.login, user.email)} error={nameerr} />;
  }

  const sql = await ready();
  const namespaces = await namespacesFor(user.id, user.username);
  const packages = sql
    ? await sql`
        SELECT p.owner, p.name, p.type, count(v.id) AS versions, max(v.created_at) AS last_push
        FROM packages p LEFT JOIN versions v ON v.package_id = p.id
        WHERE p.owner = ANY(${namespaces})
        GROUP BY p.id ORDER BY p.owner, p.name`
    : [];
  const tokens = sql
    ? await sql`
        SELECT id, note, created_at, last_used_at FROM tokens
        WHERE user_id = ${user.id} ORDER BY created_at DESC`
    : [];

  return (
    <AccountDashboard
      username={user.username}
      namespaces={namespaces}
      packages={packages.map((p) => ({
        owner: String(p.owner),
        name: String(p.name),
        type: String(p.type ?? "layer"),
        versions: Number(p.versions),
        lastPush: p.last_push as string | Date | null,
      }))}
      keys={tokens.map((t) => ({
        id: String(t.id),
        note: t.note ? String(t.note) : "",
        createdAt: t.created_at as string | Date | null,
        lastUsedAt: t.last_used_at as string | Date | null,
      }))}
    />
  );
}
