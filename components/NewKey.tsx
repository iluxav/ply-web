"use client";

// The one-time key arrives in a fragment, never in server logs or referrers.
// Strip it immediately and keep it only in this component's memory.
import { useEffect, useState } from "react";
import { CopyButton } from "./CopyButton";
import styles from "./Account.module.css";

export function NewKey() {
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#key=")) return;
    // Synchronize the browser-only secret handoff after SSR, exactly once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(decodeURIComponent(hash.slice("#key=".length)));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

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
        <form method="post" action="/api/auth/tokens/" className={styles.keyForm}>
          <div>
            <label htmlFor="key-note">Key label <span className={styles.caption}>(optional)</span></label>
            <input id="key-note" name="note" placeholder="e.g. ci: my-app" className={styles.input} />
          </div>
          <button className={styles.primary}>Generate key <span aria-hidden="true">+</span></button>
        </form>
      )}
    </div>
  );
}
