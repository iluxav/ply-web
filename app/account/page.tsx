// /account — the registry account's face: identity, published packages,
// CLI tokens with revocation. Session-gated; signed-out visitors get the
// GitHub door.
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ready } from "@/lib/db";
import { sessionUser } from "@/lib/session";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Account",
  description: "Your ply registry account: packages, CLI tokens, publishing.",
  path: "/account/",
});

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "never";
  return new Date(d).toISOString().slice(0, 16).replace("T", " ");
}

export default function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl px-5 py-16 font-mono text-[13px] text-fade sm:px-7">
          loading account…
        </div>
      }
    >
      <AccountBody searchParams={searchParams} />
    </Suspense>
  );
}

async function AccountBody({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const { err } = await searchParams;
  const user = await sessionUser();

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-7">
        <p className="font-mono text-[10px] uppercase tracking-wider text-accent">account</p>
        <h1 className="mt-3 text-3xl font-medium tracking-[-0.035em]">Publish to the registry</h1>
        <p className="mt-4 max-w-xl leading-7 text-fade">
          Sign in with GitHub — your username becomes your registry
          namespace. Then <span className="font-mono text-ink">ply login</span> and{" "}
          <span className="font-mono text-ink">ply push</span> from any terminal.
        </p>
        {err ? (
          <p className="mt-4 font-mono text-[13px] text-accent">
            sign-in did not complete ({err}) — try again
          </p>
        ) : null}
        <a
          href="/api/auth/login/"
          className="joined-control mt-8 inline-flex items-center px-5 py-3 font-mono text-[13px]"
        >
          Sign in with GitHub →
        </a>
        <p className="mt-6 text-sm leading-6 text-fade">
          Installing packages needs no account — the registry reads are
          public files. Accounts exist only to publish.
        </p>
      </div>
    );
  }

  const sql = await ready();
  const packages = sql
    ? await sql`
        SELECT p.name, p.type, count(v.id) AS versions, max(v.created_at) AS last_push
        FROM packages p LEFT JOIN versions v ON v.package_id = p.id
        WHERE p.owner = ${user.login.toLowerCase()}
        GROUP BY p.id ORDER BY p.name`
    : [];
  const tokens = sql
    ? await sql`
        SELECT id, note, created_at, last_used_at FROM tokens
        WHERE user_id = ${user.id} ORDER BY created_at DESC`
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-7">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-accent">account</p>
          <h1 className="mt-3 text-3xl font-medium tracking-[-0.035em]">{user.login}</h1>
          <p className="mt-2 font-mono text-[13px] text-fade">
            registry namespace: <span className="text-ink">{user.login.toLowerCase()}/</span>
          </p>
        </div>
        <form method="post" action="/api/auth/logout/">
          <button className="font-mono text-[13px] text-fade transition-colors hover:text-accent">
            sign out
          </button>
        </form>
      </div>

      <h2 className="mt-12 font-mono text-[10px] uppercase tracking-wider text-accent">packages</h2>
      {packages.length === 0 ? (
        <div className="mt-3 border border-edge p-5 font-mono text-[13px] text-fade">
          nothing published yet —{" "}
          <span className="text-ink">ply login && ply push your-app-1.0.0-linux-x64.img</span>
        </div>
      ) : (
        <div className="mt-3 border border-edge">
          {packages.map((p) => (
            <div key={String(p.name)} className="flex items-baseline gap-4 border-b border-edge/60 px-5 py-3 font-mono text-[13px] last:border-b-0">
              <Link href={`https://registry.plybox.sh/${user.login.toLowerCase()}/${p.name}/index.json`} className="text-ink hover:text-accent">
                {user.login.toLowerCase()}/{String(p.name)}
              </Link>
              <span className="text-fade">{String(p.versions)} version{Number(p.versions) === 1 ? "" : "s"}</span>
              <span className="ml-auto text-fade">last push {fmtDate(p.last_push as string)}</span>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-12 font-mono text-[10px] uppercase tracking-wider text-accent">cli tokens</h2>
      <p className="mt-2 text-sm leading-6 text-fade">
        Minted by <span className="font-mono text-ink">ply login</span>; only hashes are stored.
        Revoking stops a token immediately.
      </p>
      {tokens.length === 0 ? (
        <div className="mt-3 border border-edge p-5 font-mono text-[13px] text-fade">no tokens — run ply login</div>
      ) : (
        <div className="mt-3 border border-edge">
          {tokens.map((t) => (
            <div key={String(t.id)} className="flex items-baseline gap-4 border-b border-edge/60 px-5 py-3 font-mono text-[13px] last:border-b-0">
              <span className="text-ink">token #{String(t.id)}</span>
              <span className="text-fade">created {fmtDate(t.created_at as string)}</span>
              <span className="text-fade">last used {fmtDate(t.last_used_at as string)}</span>
              <form method="post" action="/api/auth/tokens/revoke/" className="ml-auto">
                <input type="hidden" name="id" value={String(t.id)} />
                <button className="text-fade transition-colors hover:text-accent">revoke</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
