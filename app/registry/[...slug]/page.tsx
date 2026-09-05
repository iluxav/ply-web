import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  registryState,
  archOf,
  alpineLinks,
  depLine,
  depsOf,
  findPackage,
  fmtSize,
  paramRows,
  pkgHref,
  srcOf,
  type RegistryPackage,
} from "@/lib/registry";
import { manifestSource, parseManifest } from "@/lib/manifest-source";
import {
  memberSnippet,
  referenceLines,
  runExample,
  stackMembers,
} from "@/lib/package-page";
import { PackageBadge, PackageMark, RegistryCode, RegistrySection } from "@/components/RegistryUI";
import styles from "@/components/Registry.module.css";
import { JsonLd } from "@/components/JsonLd";
import { absoluteUrl, pageMetadata, SITE_URL } from "@/lib/site";

function packageSummary(pkg: RegistryPackage) {
  if (pkg.description) return pkg.description;
  const latest = pkg.versions.at(-1);
  if (!latest) return `${pkg.name} in the official ply package registry.`;
  if (pkg.type === "stack") return `${pkg.name} ${latest.version} — an app composition defined in a plain TOML manifest. Inspect its members or run it with ply up.`;
  const architectures = [
    ...new Set(
      pkg.versions
        .filter((version) => version.version === latest.version)
        .map(archOf),
    ),
  ];
  return `${pkg.name} ${latest.version} for Linux ${architectures.join(" and ")}. Browse available builds and add the package to ply.toml.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = findPackage(await registryState(), slug);
  return p
    ? pageMetadata({
        title: `${p.name} package`,
        description: packageSummary(p),
        path: pkgHref(p.namespace, p.name),
      })
    : {};
}

export default async function PackagePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const state = await registryState();
  const p = findPackage(state, slug);
  if (!p || p.versions.length === 0) notFound();

  const latest = p.versions[p.versions.length - 1];
  const range = latest.version.split(".").slice(0, 2).join(".");
  const dependency = depLine(p, range);
  const description = packageSummary(p);
  const packageUrl = absoluteUrl(pkgHref(p.namespace, p.name));
  const latestBuilds = p.versions.filter(
    (version) => version.version === latest.version,
  );
  const architectures = [...new Set(latestBuilds.map(archOf))];

  const manifestText = latest.manifest ? await manifestSource(latest.manifest) : null;
  const manifest = manifestText ? parseManifest(manifestText) : null;

  const runLine = runExample(p, latest, manifest);
  const references = referenceLines(p, latest, manifest);
  const member = memberSnippet(p, latest, manifest);
  const memberBlock = member && references.length > 0
    ? `${member}\n# references: ${references.join(", ")}`
    : member;
  // A stack isn't a `[dependencies]` entry — it's referenced via its own
  // `[[app]] run = …` line, which the member/run examples above already
  // show — so the dependency example is for layers and apps only.
  const showDependencyExample = p.type !== "stack";
  const hasExamples = Boolean(runLine) || Boolean(memberBlock) || showDependencyExample;
  const members = stackMembers(manifest);
  const parameters = paramRows(latest.params);
  const dependencies = depsOf(latest);
  const hasExternalBuilds = p.versions.some((version) => version.verified === false);

  return (
    <main className={styles.page}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "SoftwareApplication",
              "@id": `${packageUrl}#package`,
              name: p.name,
              description,
              url: packageUrl,
              sameAs: p.homepage || undefined,
              applicationCategory: "DeveloperApplication",
              operatingSystem: "Linux",
              softwareVersion: latest.version,
              softwareRequirements: p.type === "stack" ? "ply on Linux" : `Linux on ${architectures.join(" or ")}`,
              downloadUrl: latestBuilds.map(srcOf).filter(Boolean),
              license: p.license || undefined,
              isPartOf: { "@id": `${SITE_URL}/registry/#catalog` },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "ply",
                  item: `${SITE_URL}/`,
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Registry",
                  item: `${SITE_URL}/registry/`,
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: p.name,
                  item: packageUrl,
                },
              ],
            },
          ],
        }}
      />

      <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
        <Link href="/registry/">registry</Link><span aria-hidden="true">/</span>
        <span>{p.namespace}</span><span aria-hidden="true">/</span>
        <span aria-current="page">{p.name}</span>
      </nav>
      <header className={styles.packageHero}>
        <div className="min-w-0">
          <div className={styles.packageTags}>
            <PackageBadge type={p.type ?? "layer"} />
            <span>{p.namespace === "ply" ? "ply namespace" : "community package"}</span>
            <span>v{latest.version}</span>
          </div>
          <div className={styles.packageTitle}>
            <PackageMark type={p.type ?? "layer"} />
            <h1>{p.name}</h1>
          </div>
          <p className={styles.intro}>{description}</p>
        </div>
        <Link href="/registry/" className={styles.backLink}>← All packages</Link>
      </header>
      <nav aria-label="Package sections" className={styles.detailNav}>
        {hasExamples && <a href="#usage">Usage</a>}
        {members.length > 0 && <a href="#members">Composition</a>}
        {p.type !== "stack" && parameters.length > 0 && <a href="#parameters">Parameters</a>}
        {dependencies.length > 0 && <a href="#dependencies">Dependencies</a>}
        {manifestText && <a href="#manifest">Manifest</a>}
        <a href="#versions">Versions <span className="ml-2 text-fade">{p.versions.length}</span></a>
      </nav>
      <div className={styles.detailGrid}>
        <div className={styles.detailContent}>
          {hasExamples && (
            <RegistrySection id="usage" title="Use this package" meta={p.type === "stack" ? "compose / run" : "copy / configure"}>
              <p className={styles.help}>
                {p.type === "stack"
                  ? "Run the published composition with ply up."
                  : p.type === "app" && runLine
                    ? "Run the app directly or compose it with other apps in your manifest."
                    : "Add this independent package to your manifest. ply resolves and pins its contents in the lockfile."}
              </p>
              {runLine && <RegistryCode title="terminal" value={runLine} note={runLine.includes("=…") ? "Replace … with your secret value before running." : undefined} />}
              {memberBlock && <RegistryCode title="ply.toml / app member" value={memberBlock} />}
              {showDependencyExample && <RegistryCode title="ply.toml / dependencies" value={"[dependencies]\n" + dependency} />}
            </RegistrySection>
          )}

          {p.type === "stack" && members.length > 0 && (
            <RegistrySection id="members" title="Composition" meta={members.length + " app members"}>
              <p className={styles.help}>Independent apps, connected through explicit parameters and references.</p>
              <div className={styles.memberList}>
                {members.map((m, index) => (
                  <article key={m.name + "-" + index} className={styles.member}>
                    <header><PackageMark type="app" /><h3>{m.name}</h3><code>{m.run}</code></header>
                    <dl>
                      {Object.keys(m.params).length > 0 && <><dt>params</dt><dd>{Object.entries(m.params).map(([k, v]) => k + " = " + JSON.stringify(v)).join(", ")}</dd></>}
                      {m.refs.length > 0 && <><dt>references</dt><dd>{m.refs.join(", ")}</dd></>}
                      {m.publish.length > 0 && <><dt>publish</dt><dd>{m.publish.join(", ")}</dd></>}
                      {m.after.length > 0 && <><dt>after</dt><dd>{m.after.join(", ")}</dd></>}
                    </dl>
                  </article>
                ))}
              </div>
            </RegistrySection>
          )}

          {p.type !== "stack" && parameters.length > 0 && (
            <RegistrySection id="parameters" title="Parameters" meta={parameters.length + " declared"}>
              <p className={styles.help}>
                Reference as <code>{"{" + p.name + ".<name>}"}</code> from a stack.
                Override with <code>{'params = { <name> = "…" }'}</code>.
              </p>
              <div className={styles.dataFrame} tabIndex={0} role="region" aria-label="Package parameters">
                <table className={styles.dataTable}>
                  <thead><tr><th scope="col">name</th><th scope="col">kind</th><th scope="col">default / expression</th></tr></thead>
                  <tbody>{parameters.map((r) => (
                    <tr key={r.name}><td>{r.name}</td><td className={styles.muted}>{r.kind}</td><td>{r.value ?? "—"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <p className={styles.footnote}>Secrets are minted per stack unless declared external. Secret values are not shown.</p>
            </RegistrySection>
          )}

          {dependencies.length > 0 && (
            <RegistrySection id="dependencies" title="Dependencies" meta={dependencies.length + " packages"}>
              <p className={styles.help}>Declared package requirements. Composed together, not inherited.</p>
              <div className={styles.dependencyList}>
                {dependencies.map((d) => (
                  <div key={d.name + "-" + d.version} className={styles.dependency}>
                    <code>{d.name}</code><span>{d.version}</span>
                  </div>
                ))}
              </div>
            </RegistrySection>
          )}

          {manifestText && (
            <RegistrySection id="manifest" title="The manifest" meta="as published">
              <details className={styles.manifest}>
                <summary>Read ply.toml</summary>
                <pre tabIndex={0} aria-label="Published ply.toml"><code>{manifestText}</code></pre>
              </details>
            </RegistrySection>
          )}

          <RegistrySection id="versions" title={p.type === "stack" ? "Published versions" : "Published builds"} meta={p.versions.length + (p.versions.length === 1 ? " record" : " records")}>
            <p className={styles.help}>
              {p.type === "stack" ? "Download the composition manifest for a published version." : "Download a package file for your architecture."}
            </p>
            <div className={styles.dataFrame} tabIndex={0} role="region" aria-label="Published builds">
              <table className={styles.dataTable}>
                <thead><tr><th scope="col">version</th><th scope="col">download</th><th scope="col">size</th><th scope="col">published</th>{hasExternalBuilds && <th scope="col">hosting</th>}</tr></thead>
                <tbody>
                  {[...p.versions].reverse().map((v, index) => (
                    <tr key={v.version + "-" + archOf(v) + "-" + index}>
                      <td className={styles.version}>{v.version}{v.version === latest.version && <small>latest</small>}</td>
                      <td>{srcOf(v) ? <a href={srcOf(v)} className={styles.download} aria-label={"Download " + p.name + " " + v.version + " " + (p.type === "stack" ? "manifest" : archOf(v))}>{p.type === "stack" ? "ply.toml" : archOf(v)} <span aria-hidden="true">↓</span></a> : <span className={styles.muted}>unavailable</span>}</td>
                      <td className="whitespace-nowrap">{fmtSize(v.bytes)}</td>
                      <td className={styles.muted + " whitespace-nowrap"}>{v.pushed_at?.slice(0, 10) || "—"}</td>
                      {hasExternalBuilds && <td className={styles.muted}>{v.verified === false ? <span title="Bytes hosted by the publisher; sha256 reported by their ply">external</span> : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RegistrySection>
        </div>

        <aside className={styles.sidebar} aria-label="Package information">
          <h2>Package record</h2>
          <dl className={styles.metadata}>
            <div><dt>namespace</dt><dd>{p.namespace}</dd></div>
            <div><dt>latest version</dt><dd>{latest.version}</dd></div>
            <div><dt>{p.type === "stack" ? "format" : "platform"}</dt><dd>{p.type === "stack" ? "TOML composition" : "Linux / " + architectures.join(" / ")}</dd></div>
            {p.type !== "stack" && <div><dt>package size · {archOf(latest)}</dt><dd>{fmtSize(latest.bytes)}</dd></div>}
            <div><dt>last published</dt><dd>{latest.pushed_at?.slice(0, 10) || "—"}</dd></div>
            <div><dt>license</dt><dd>{p.license || "Not specified"}</dd></div>
            {latest.publish && <div><dt>publish</dt><dd>{latest.publish}</dd></div>}
            {Boolean(latest.volumes?.length) && <div><dt>volumes</dt><dd>{latest.volumes?.map((v) => <div key={v}>{v}</div>)}</dd></div>}
          </dl>
          {(p.homepage || latest.manifest || p.alpine) && (
            <div className={styles.sidebarBlock}>
              <h3>Sources & provenance</h3>
              {p.homepage && <a href={p.homepage}>Project homepage ↗</a>}
              {latest.manifest && <a href={latest.manifest}>Published ply.toml ↗</a>}
              {p.alpine && <>
                <p>Unmodified Alpine Linux {p.alpine.branch} build.</p>
                <a href={alpineLinks(p.alpine).package}>Alpine package ↗</a>
                <a href={alpineLinks(p.alpine).source}>Source (aports) ↗</a>
              </>}
            </div>
          )}
          <div className={styles.sidebarBlock}>
            <h3>Files, not a service.</h3>
            <p>Inspect the manifest. Pin your dependencies. Run with no daemon in between.</p>
            <Link href="/docs/dependencies/">How ply composes packages →</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
