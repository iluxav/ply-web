"use client";

// Revoke in place: post as JSON, then refresh the server-rendered list.
// Without JavaScript the form posts as HTML and the server redirects back.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./Account.module.css";

export function RevokeKey({ id, label }: { id: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/tokens/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: Number(id) }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" action="/api/auth/tokens/revoke/" onSubmit={submit}>
      <input type="hidden" name="id" value={id} />
      <button className={styles.revoke} disabled={busy} aria-label={"Revoke " + label}>{busy ? "Revoking…" : "Revoke"}</button>
    </form>
  );
}
