"use client";

// Mint a CLI key from the account page, and show it exactly once.
//
// The freshly minted key comes back in the redirect's URL FRAGMENT — a
// fragment is never sent to the server and never lands in an access log or
// a Referer header. We read it, strip it from the address bar immediately,
// and hold it in memory until the page is left.
import { useEffect, useState } from "react";
import { CopyButton } from "./CopyButton";

export function NewKey() {
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#key=")) return;
    setKey(decodeURIComponent(hash.slice("#key=".length)));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return (
    <div className="mt-4">
      {key ? (
        <div className="border border-accent/60 p-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-accent">
            your new key — copy it now, it is never shown again
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="break-all font-mono text-[13px] text-ink">{key}</code>
            <CopyButton value={key} />
          </div>
          <div className="mt-3 font-mono text-[11px] leading-5 text-fade">
            CI: store it as a repository secret, then{" "}
            <span className="text-ink">env: PLY_TOKEN: ${"{{"} secrets.PLY_TOKEN {"}}"}</span>
            <br />
            this machine: <span className="text-ink">ply login</span> writes one for you
          </div>
        </div>
      ) : (
        <form method="post" action="/api/auth/tokens/" className="flex flex-wrap items-center gap-3">
          <input
            name="note"
            placeholder="what is it for? (e.g. ci: ply-web)"
            className="control-shape min-h-11 flex-1 border border-edge bg-transparent px-3 font-mono text-[13px] text-ink placeholder:text-fade/50 md:min-h-9 md:max-w-sm"
          />
          <button className="control-shape min-h-11 border border-edge px-4 font-mono text-[11px] text-fade transition-colors hover:border-accent hover:text-accent md:min-h-9">
            generate a key
          </button>
        </form>
      )}
    </div>
  );
}
