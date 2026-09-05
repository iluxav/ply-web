import Link from "next/link";
import { NewKey } from "./NewKey";
import { PackageBadge, PackageMark, RegistryCode } from "./RegistryUI";
import { pkgHref } from "../lib/registry";
import styles from "./Account.module.css";

type DateValue = string | Date | null;
export type AccountPackage = { owner: string; name: string; type: string; versions: number; lastPush: DateValue };
export type AccountKey = { id: string; note: string; createdAt: DateValue; lastUsedAt: DateValue };

function fmtDate(value: DateValue) {
  return value ? new Date(value).toISOString().slice(0, 16).replace("T", " ") : "never";
}

function AccountTitle() {
  return <><p className={styles.eyebrow}>Registry / publishing access</p><h1 className={styles.title}><span>/</span>account<span>_</span></h1></>;
}

function PublicRegistryNote() {
  return <div className={styles.publicNote}><p><strong>Just here to run something?</strong><br />Package downloads are public files. No account required.</p><Link href="/registry/" className={styles.textLink}>Explore the registry →</Link></div>;
}

export function SignedOutAccount({ error }: { error?: string }) {
  return (
    <main className={styles.page}>
      <AccountTitle />
      <p className={styles.intro}>Your packages. Your namespace.<br />Sign in to publish from your terminal and manage your CLI keys.</p>
      <div className={styles.signinGrid}>
        <section className={styles.signinPanel} aria-labelledby="signin-title">
          <div className={styles.panelLabel}>identity / GitHub</div>
          <div className={styles.panelBody}>
            <h2 id="signin-title">Make a place for your code.</h2>
            <p className={styles.help}>Connect your GitHub account, choose your registry username, and start publishing under your own namespace.</p>
            {error && <p role="alert" className={styles.error}>Sign-in did not complete ({error}). Try signing in again.</p>}
            <a href="/api/auth/login/" className={styles.primary + " " + styles.signinButton}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.82c.56.1.77-.24.77-.54v-2.09c-3.13.68-3.79-1.33-3.79-1.33-.51-1.29-1.25-1.63-1.25-1.63-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .1.85 2.22 3.29 1.53.1-.72.39-1.21.71-1.49-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .94-.3 3.08 1.15a10.67 10.67 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.03.76 2.08v3.07c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z" /></svg>
              Sign in with GitHub <span aria-hidden="true">↗</span>
            </a>
            <p className={styles.caption}>Authentication happens on GitHub. Publishing happens in your terminal.</p>
          </div>
        </section>
        <section className={styles.terminal} aria-labelledby="terminal-title">
          <h2 id="terminal-title">Then, back to your terminal.</h2>
          <RegistryCode flat title="terminal / publish a package" value={"ply login\nply push ./your-app-1.0.0-linux-x64.img"} note="Replace the example filename with your built package." />
          <dl className={styles.steps}>
            <div><dt>01</dt><dd><strong>Claim your namespace.</strong> A stable home for the packages you publish.</dd></div>
            <div><dt>02</dt><dd><strong>Connect your CLI.</strong> Use <code>ply login</code> on your machine, or a key in CI.</dd></div>
            <div><dt>03</dt><dd><strong>Push a file.</strong> Make your package available through the registry.</dd></div>
          </dl>
          <Link href="/docs/registries/" className={styles.textLink}>Read the publishing guide →</Link>
        </section>
      </div>
      <PublicRegistryNote />
    </main>
  );
}

export function ClaimUsername({ suggestion, error }: { suggestion: string; error?: string }) {
  return (
    <main className={styles.page}>
      <AccountTitle />
      <p className={styles.intro}>One name. A permanent home for your packages.</p>
      <div className={styles.signinGrid}>
        <section className={styles.signinPanel} aria-labelledby="claim-title">
          <div className={styles.panelLabel}>setup / registry namespace</div>
          <div className={styles.panelBody}>
            <h2 id="claim-title">Choose your username.</h2>
            <p className={styles.help}>Pick it once. Your namespace stays the same, even if you rename your GitHub account.</p>
            <form method="post" action="/api/auth/username/" className={styles.claimForm}>
              <label htmlFor="registry-username" className={styles.claimLabel}>Registry username</label>
              <input id="registry-username" name="username" defaultValue={suggestion} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={2} maxLength={39} aria-describedby={error ? "username-hint username-error" : "username-hint"} aria-invalid={Boolean(error)} className={styles.input} />
              <p id="username-hint" className={styles.caption}>2–39 characters: lowercase letters, digits and dashes. Start and end with a letter or digit.</p>
              {error && <p id="username-error" role="alert" className={styles.error}>{error}</p>}
              <button className={styles.primary}>Claim username →</button>
            </form>
          </div>
        </section>
        <section className={styles.terminal} aria-labelledby="namespace-title">
          <h2 id="namespace-title">Your name is part of the address.</h2>
          <p className={styles.help}>Every package you publish lives under your chosen namespace. This is an example of its registry path:</p>
          <pre className={styles.path}><code>registry.plybox.sh/{"\n"}<strong>└── {suggestion || "your-name"}/</strong>{"\n"}    └── your-package/{"\n"}        └── index.json</code></pre>
          <p className={styles.caption}>The namespace is permanent. Check the spelling before claiming it.</p>
        </section>
      </div>
      <PublicRegistryNote />
    </main>
  );
}

export function AccountDashboard({ username, namespaces, packages, keys }: { username: string; namespaces: string[]; packages: AccountPackage[]; keys: AccountKey[] }) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Account / publishing workspace</p><h1 className={styles.title}><span>~/</span>{username}</h1><p className={styles.intro}>Your published packages and the keys that ship them.</p></div>
        <form method="post" action="/api/auth/logout/"><button className={styles.secondary}>Sign out ↗</button></form>
      </header>
      <nav aria-label="Account sections" className={styles.summary}>
        <a href="#packages"><strong>{packages.length}</strong> {packages.length === 1 ? "package" : "packages"}</a>
        <a href="#keys"><strong>{keys.length}</strong> CLI {keys.length === 1 ? "key" : "keys"}</a>
        <a href="#namespaces"><strong>{namespaces.length}</strong> {namespaces.length === 1 ? "namespace" : "namespaces"}</a>
        <span>Registry access / signed in</span>
      </nav>
      <div className={styles.dashboard}>
        <div className={styles.content}>
          <section id="packages" className={styles.section} aria-labelledby="packages-title">
            <div className={styles.sectionHeader}><h2 id="packages-title">Published packages</h2><span>{packages.length} total</span></div>
            {packages.length === 0 ? (
              <div className={styles.empty}><h3>Your first package goes here.</h3><p>Build your app, connect with <code>ply login</code>, then push the package file to your namespace.</p><Link href="/docs/registries/" className={styles.textLink}>Learn how to publish →</Link></div>
            ) : (
              <div className={styles.packageList}>{packages.map((p) => (
                <article key={p.owner + "/" + p.name} className={styles.package}>
                  <div className={styles.packageIdentity}><PackageMark type={p.type} /><div><Link href={pkgHref(p.owner, p.name)}><span>{p.owner}/</span>{p.name}</Link><p><PackageBadge type={p.type} /><span>{p.versions} version{p.versions === 1 ? "" : "s"}</span></p></div></div>
                  <div className={styles.packageMeta}><p>Last push {fmtDate(p.lastPush)}{p.lastPush ? " UTC" : ""}</p><a href={"https://registry.plybox.sh/" + encodeURIComponent(p.owner) + "/" + encodeURIComponent(p.name) + "/index.json"}>Raw index ↗</a></div>
                </article>
              ))}</div>
            )}
          </section>
          <section id="keys" className={styles.section} aria-labelledby="keys-title">
            <div className={styles.sectionHeader}><h2 id="keys-title">CLI keys</h2><span>{keys.length} total</span></div>
            <p className={styles.help}>Connect a machine with <code>ply login</code>, use <code>ply key new</code>, or generate a key here for CI. Keys are shown once; only their hashes are stored.</p>
            <NewKey />
            {keys.length === 0 ? (
              <div className={styles.empty}><h3>No CLI keys yet.</h3><p>Generate a key above or run <code>ply login</code> on your machine. Your keys will appear here.</p></div>
            ) : (
              <div className={styles.keyList}>{keys.map((key) => (
                <article key={key.id} className={styles.key}>
                  <div className={styles.keyIdentity}><h3>{key.note || "Unnamed key"}<span>key #{key.id}</span></h3><div className={styles.keyDates}><span>Created {fmtDate(key.createdAt)}{key.createdAt ? " UTC" : ""}</span><span>Last used {fmtDate(key.lastUsedAt)}{key.lastUsedAt ? " UTC" : ""}</span></div></div>
                  <form method="post" action="/api/auth/tokens/revoke/"><input type="hidden" name="id" value={key.id} /><button className={styles.revoke} aria-label={"Revoke " + (key.note || "key") + " #" + key.id}>Revoke</button></form>
                </article>
              ))}</div>
            )}
            <p className={styles.caption}>Revoking a key stops its access immediately. Keep keys out of source control.</p>
          </section>
        </div>
        <aside className={styles.sidebar} aria-label="Publishing information">
          <section id="namespaces"><h2>Your namespaces</h2>{namespaces.map((ns) => <code key={ns} className={styles.namespace}>{ns}/</code>)}<p className={styles.help}>You can publish packages to these namespaces.</p></section>
          <section className={styles.sidebarSection}><h3>Publish from your terminal.</h3><RegistryCode flat title="terminal / connect" value="ply login" /><p className={styles.caption}>Then push your built package with <code>ply push</code>.</p><Link href="/docs/registries/" className={styles.textLink}>Publishing guide →</Link></section>
          <section className={styles.sidebarSection}><h3>Shipping from CI?</h3><p className={styles.help}>Store a key in a repository secret and expose it as <code>PLY_TOKEN</code> in your publishing job. Never put the key in your manifest.</p><Link href="/registry/" className={styles.textLink}>Browse the registry →</Link></section>
        </aside>
      </div>
    </main>
  );
}
