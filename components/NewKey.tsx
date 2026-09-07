"use client";

// Generating a key stays on the page: the form posts as JSON, the key is
// shown from memory, and the list underneath refreshes without a
// navigation. Without JavaScript the same form still posts as HTML and the
// server answers with a redirect carrying the key in a fragment, which is
// why the fragment path is kept: it never reaches server logs or referrers.
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CopyButton } from "./CopyButton";
import styles from "./Account.module.css";

export function NewKey() {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#key=")) return;
    // Synchronize the browser-only secret handoff after SSR, exactly once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(decodeURIComponent(hash.slice("#key=".length)));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/tokens/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !body.token) {
        setError(body.error ?? `the registry answered ${res.status}`);
        return;
      }
      setKey(body.token);
      router.refresh(); // the list below re-renders on the server; no navigation
    } catch {
      setError("could not reach the registry — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.newKey}>
      {key ? (
        <section className={styles.keyReveal} aria-labelledby="new-key-title">
          <h3 id="new-key-title" role="status">Your key is ready. Copy it now.</h3>
          <p className={styles.help}>This is the only time the full key is shown. Save it somewhere secure before leaving this page.</p>
          <div className={styles.secretRow}>
            <code>{key}</code>
            <CopyButton value={key} label="copy new CLI key" />
          </div>
          <p className={styles.help}>For CI, store it as a repository secret and expose it as <code>PLY_TOKEN</code>. On your machine, <code>ply login</code> creates and saves a key for you.</p>
        </section>
      ) : (
        <form method="post" action="/api/auth/tokens/" className={styles.keyForm} onSubmit={submit}>
          <div>
            <label htmlFor="key-note">Key label <span className={styles.caption}>(optional)</span></label>
            <input id="key-note" name="note" placeholder="e.g. ci: my-app" className={styles.input} />
          </div>
          <button className={styles.primary} disabled={busy}>{busy ? "Generating…" : <>Generate key <span aria-hidden="true">+</span></>}</button>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </form>
      )}
    </div>
  );
}
