// /account — the registry account's face: identity, published packages,
// CLI tokens with revocation. Session-gated; signed-out visitors get the
// GitHub door.
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ready } from "@/lib/db";
import { sessionUser } from "@/lib/session";
import { pageMetadata } from "@/lib/site";
import { namespacesFor, suggestUsername } from "@/lib/namespaces";
import { NewKey } from "@/components/NewKey";

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
  searchParams: Promise<{ err?: string; nameerr?: string }>;
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
  searchParams: Promise<{ err?: string; nameerr?: string }>;
}) {
  const { err, nameerr } = await searchParams;
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

  // No username yet — a first sign-in, or an account that arrived through
  // a provider before choosing one. Nothing else on this page can mean
  // anything until the namespace exists, so it is the whole page.
  if (!user.username) {
    const suggestion = suggestUsername(user.login, user.email);
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-7">
        <p className="font-mono text-[10px] uppercase tracking-wider text-accent">account</p>
        <h1 className="mt-3 text-3xl font-medium tracking-[-0.035em]">Choose your username</h1>
        <p className="mt-4 max-w-xl leading-7 text-fade">
          It becomes your registry namespace — packages you publish are filed
          under <span className="font-mono text-ink">{suggestion || "you"}/…</span> forever. Pick it
          once: it is yours from then on, and renaming elsewhere never moves it.
        </p>
        <form method="post" action="/api/auth/username/" className="mt-8 flex flex-wrap items-center gap-3">
          <input
            name="username"
            defaultValue={suggestion}
            autoFocus
            spellCheck={false}
            className="control-shape min-h-11 border border-edge bg-transparent px-3 font-mono text-[15px] text-ink"
          />
          <button className="joined-control inline-flex min-h-11 items-center px-5 font-mono text-[13px]">
            claim it →
          </button>
        </form>
        {nameerr ? <p className="mt-4 font-mono text-[13px] text-accent">{nameerr}</p> : null}
        <p className="mt-6 font-mono text-[11px] leading-5 text-fade">
          2–39 characters: lowercase letters, digits and dashes.
        </p>
      </div>
    );
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
    <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-7">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-accent">account</p>
          <h1 className="mt-3 text-3xl font-medium tracking-[-0.035em]">{user.username}</h1>
          <p className="mt-2 font-mono text-[13px] text-fade">
            {namespaces.length > 1 ? "publishes to" : "registry namespace"}:{" "}
            {namespaces.map((ns, i) => (
              <span key={ns}>
                {i > 0 ? <span className="text-fade">, </span> : null}
                <span className="text-ink">{ns}/</span>
              </span>
            ))}
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
            <div key={`${p.owner}/${p.name}`} className="flex items-baseline gap-4 border-b border-edge/60 px-5 py-3 font-mono text-[13px] last:border-b-0">
              <Link href={`https://registry.plybox.sh/${p.owner}/${p.name}/index.json`} className="text-ink hover:text-accent">
                {String(p.owner)}/{String(p.name)}
              </Link>
              <span className="text-fade">{String(p.versions)} version{Number(p.versions) === 1 ? "" : "s"}</span>
              <span className="ml-auto text-fade">last push {fmtDate(p.last_push as string)}</span>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-12 font-mono text-[10px] uppercase tracking-wider text-accent">cli keys</h2>
      <p className="mt-2 text-sm leading-6 text-fade">
        Minted by <span className="font-mono text-ink">ply login</span>, by{" "}
        <span className="font-mono text-ink">ply key new</span>, or here. A key is shown once —
        only its hash is stored. For CI, put one in a repository secret and set{" "}
        <span className="font-mono text-ink">PLY_TOKEN</span>; revoking stops it immediately.
      </p>

      <NewKey />

      {tokens.length === 0 ? (
        <div className="mt-3 border border-edge p-5 font-mono text-[13px] text-fade">no keys yet</div>
      ) : (
        <div className="mt-3 border border-edge">
          {tokens.map((t) => (
            <div key={String(t.id)} className="flex items-baseline gap-4 border-b border-edge/60 px-5 py-3 font-mono text-[13px] last:border-b-0">
              <span className="text-ink">key #{String(t.id)}</span>
              {t.note ? <span className="text-fade">{String(t.note)}</span> : null}
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
