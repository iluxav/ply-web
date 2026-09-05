import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { CopyButton } from "@/components/CopyButton";
import { PackageExplorer } from "@/components/PackageExplorer";
import { JsonLd } from "@/components/JsonLd";
import { GITHUB_URL, SITE_DESCRIPTION, SITE_URL } from "@/lib/site";
import styles from "./home.module.css";

export const metadata: Metadata = { alternates: { canonical: "/" } };
const INSTALL_COMMAND = "curl -fsSL https://plybox.sh/install.sh | sh";
const principles = [
  { symbol: "{ }", title: "Compose explicit parts.", text: "Declare a set of named dependencies. The lockfile pins each version and hash; shared packages keep their own identity.", link: "/docs/dependencies/", label: "Meet the package model" },
  { symbol: "./", title: "Keep it in files.", text: "Intent in TOML. Packages in a content-addressed store. Runtime state in JSON. Files you can inspect, copy, and version with familiar tools.", link: "/docs/architecture/", label: "See how the pieces fit" },
  { symbol: ">_", title: "Run without a daemon.", text: "Linux provides namespaces and cgroups. Your app is a process, logs flow to stdout, and signals work. No central Ply daemon to keep alive.", link: "/docs/architecture/", label: "Read the architecture" },
];

export default function Home() {
  return (
    <main className={styles.home}>
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "SoftwareApplication", "@id": `${SITE_URL}/#software`,
        name: "ply", description: SITE_DESCRIPTION, url: `${SITE_URL}/`, downloadUrl: `${SITE_URL}/install.sh`,
        codeRepository: GITHUB_URL, applicationCategory: "DeveloperApplication", operatingSystem: "Linux",
        softwareRequirements: "Linux on x86_64 or arm64", license: `${GITHUB_URL}/blob/main/LICENSE`,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      }} />
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.kicker}><span className={styles.statusDot} /> SMALL TOOL. UNIX SOUL.</p>
          <h1 id="hero-title">Containers.<br /><span>The Unix way.</span></h1>
          <p className={styles.heroLead}>Compose packages.<br />Ship files. Run processes.</p>
          <p className={styles.heroDescription}>A daemonless container runtime and package manager for Linux. Explicit dependencies, inspectable files, and a process you control.</p>
          <div className={styles.heroActions}>
            <Link href="/docs/quickstart/" className={styles.primaryButton}>Get started <span aria-hidden="true">↗</span></Link>
            <a href={GITHUB_URL} className={styles.textLink}>Read the source <span aria-hidden="true">↗</span></a>
          </div>
          <div className={styles.install}>
            <span aria-hidden="true" className={styles.prompt}>$</span><code>{INSTALL_COMMAND}</code>
            <CopyButton value={INSTALL_COMMAND} label="Copy install command" iconOnly className={styles.copyButton} />
          </div>
          <p className={styles.compatibility}>Linux x86_64 / arm64 <span>·</span> Open source <span>·</span> Pre-1.0</p>
        </div>
        <PackageExplorer />
      </section>
      <div className={styles.primitives} aria-label="Ply at a glance">
        <span className={styles.primitivesLabel}>LESS MACHINERY.<br /><strong>MORE LINUX.</strong></span>
        <span><i aria-hidden="true">✓</i> One static binary</span><span><i aria-hidden="true">✓</i> No daemon</span>
        <span><i aria-hidden="true">✓</i> No Dockerfile</span><span><i aria-hidden="true">✓</i> Just files & processes</span>
      </div>
      <section className={styles.workflow} aria-labelledby="workflow-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>FROM YOUR SHELL TO YOUR SERVER</p><h2 id="workflow-title">Ship it with <code>scp.</code><br />Yes, really.</h2></div>
          <p>Your app ships as a file with locked dependency references.<br />The packages come together when it runs.</p>
        </div>
        <div className={styles.workbench}>
          <div className={styles.manifest}>
            <div className={styles.fileBar}><span><span aria-hidden="true">≡</span> ply.toml</span><span>TOML</span></div>
            <pre><code><span className={styles.comment}># A whole container, in plain text.</span>{"\n"}<span className={styles.syntax}>[package]</span>{"\n"}name = <span className={styles.string}>&quot;hello&quot;</span>{"\n"}version = <span className={styles.string}>&quot;0.1.0&quot;</span>{"\n"}base = <span className={styles.string}>&quot;debian@13&quot;</span>{"\n"}entrypoint = [<span className={styles.string}>&quot;python3&quot;</span>, <span className={styles.string}>&quot;app.py&quot;</span>]{"\n\n"}<span className={styles.syntax}>[dependencies]</span>{"\n"}python3 = <span className={styles.string}>&quot;3.13&quot;</span>{"\n\n"}<span className={styles.syntax}>[sources]</span>{"\n"}default = <span className={styles.string}>&quot;https://registry.plybox.sh/ply/&#123;package&#125;&quot;</span></code></pre>
            <div className={styles.fileFoot}>Your app.py lives beside this file. <span>That’s the setup.</span></div>
          </div>
          <ol className={styles.steps}>
            <li><span className={styles.stepNumber}>01</span><div><h3>Build your package.</h3><code><span>$</span> ply build .</code><p>Resolve dependencies. Lock the hashes. Emit an image.</p></div></li>
            <li><span className={styles.stepNumber}>02</span><div><h3>Put it on your server.</h3><code><span>$</span> scp hello-*.img server:</code><p>SSH, a file server, a USB drive. It’s just a file.</p></div></li>
            <li><span className={styles.stepNumber}>03</span><div><h3>Run it like a process.</h3><code><span>$</span> ssh server ply run hello-*.img</code><p>Dependencies fetch by hash. Your app gets its own sandbox.</p></div></li>
          </ol>
        </div>
        <div className={styles.workflowFoot}><span><span aria-hidden="true">↳</span> Foreground by default. Ctrl-C works. Exit codes propagate.</span><Link href="/docs/quickstart/" className={styles.textLink}>Walk through the quickstart <span aria-hidden="true">→</span></Link></div>
      </section>
      <section className={styles.philosophy} aria-labelledby="philosophy-title">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>GOOD TOOLS GET OUT OF YOUR WAY</p><h2 id="philosophy-title">Less magic.<br />More understanding.</h2></div><p>For people who want to know what’s running,<br />where the bytes came from, and how to stop it.</p></div>
        <div className={styles.principles}>
          {principles.map((item) => <article key={item.title}><span className={styles.principleSymbol} aria-hidden="true">{item.symbol}</span><h3>{item.title}</h3><p>{item.text}</p><Link href={item.link} className={styles.textLink}>{item.label} <span aria-hidden="true">↗</span></Link></article>)}
        </div>
        <Link className={styles.comparison} href="/docs/ply-vs-docker/"><span><span className={styles.comment}>$ man</span> ply-vs-docker</span><span>The tradeoffs, honestly. <span aria-hidden="true">↗</span></span></Link>
      </section>
      <section className={styles.closing} aria-labelledby="closing-title"><div><p className={styles.kicker}>YOUR MACHINE. YOUR RULES.</p><h2 id="closing-title">Make yourself at <code>~/home.</code></h2><p>Start with your app. Bring your favorite tools.</p></div><Link href="/docs/quickstart/" className={styles.primaryButton}>Let’s build something <span aria-hidden="true">↗</span></Link></section>
      <footer className={styles.footer}><Link href="/" className={styles.footerLogo} aria-label="ply home"><BrandLogo /></Link><p>Built on Linux. In the spirit of Unix.</p><nav aria-label="Footer navigation"><Link href="/docs/">Documentation</Link><Link href="/registry/">Packages</Link><a href={GITHUB_URL}>GitHub ↗</a></nav><span className={styles.footerEnd}>EOF <span aria-hidden="true">■</span></span></footer>
    </main>
  );
}
