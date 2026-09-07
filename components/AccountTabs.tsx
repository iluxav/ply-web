"use client";

// Packages and keys as two tabs. The hash names the tab (`#keys`), so the
// summary links above still work and a reload keeps the view; the key
// handoff fragment (`#key=…`) also opens the keys tab, which is where the
// key is shown. Panels stay in the DOM, hidden, so nothing re-fetches.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Account.module.css";

type Tab = "packages" | "keys";

function tabFromHash(hash: string): Tab | null {
  if (hash === "#keys" || hash.startsWith("#key=")) return "keys";
  if (hash === "#packages") return "packages";
  return null;
}

export function AccountTabs({
  packages,
  keys,
  packageCount,
  keyCount,
}: {
  packages: ReactNode;
  keys: ReactNode;
  packageCount: number;
  keyCount: number;
}) {
  const [tab, setTab] = useState<Tab>("packages");

  useEffect(() => {
    const apply = () => {
      const t = tabFromHash(window.location.hash);
      if (t) setTab(t);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  function choose(t: Tab) {
    setTab(t);
    window.history.replaceState(null, "", `#${t}`);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: Tab = tab === "packages" ? "keys" : "packages";
    choose(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "packages", label: "Packages", count: packageCount },
    { id: "keys", label: "CLI keys", count: keyCount },
  ];

  return (
    <div>
      <div role="tablist" aria-label="Account sections" className={styles.tabs} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className={styles.tab}
            onClick={() => choose(t.id)}
          >
            {t.label} <span>{t.count}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="packages" aria-labelledby="tab-packages" hidden={tab !== "packages"}>
        {packages}
      </div>
      <div role="tabpanel" id="keys" aria-labelledby="tab-keys" hidden={tab !== "keys"}>
        {keys}
      </div>
    </div>
  );
}
