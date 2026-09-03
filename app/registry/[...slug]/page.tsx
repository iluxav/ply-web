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
import { CopyButton } from "@/components/CopyButton";
import { JsonLd } from "@/components/JsonLd";
import { absoluteUrl, pageMetadata, SITE_URL } from "@/lib/site";

function packageSummary(pkg: RegistryPackage) {
  if (pkg.description) return pkg.description;
  const latest = pkg.versions.at(-1);
  if (!latest) return `${pkg.name} in the official ply package registry.`;
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
  if (!p) notFound();

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

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-20 pt-10 sm:px-7 sm:pt-14">
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
              softwareRequirements: `Linux on ${architectures.join(" or ")}`,
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
      <p className="font-mono text-xs text-fade">
        <Link href="/registry/" className="hover:text-accent">packages</Link> / {p.namespace}
      </p>
      <h1 className="mt-4 text-4xl font-medium tracking-[-0.04em] sm:text-5xl">{p.name}</h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-fade">{description}</p>
      <p className="mt-4 font-mono text-xs text-fade">
        {p.license && <span className="mr-4">license: {p.license}</span>}
        {p.homepage && (
          <a href={p.homepage} className="text-accent hover:underline">{p.homepage}</a>
        )}
      </p>
      {p.alpine && (
        <p className="mt-2 font-mono text-xs text-fade">
          unmodified Alpine Linux {p.alpine.branch} build ·{" "}
          <a href={alpineLinks(p.alpine).package} className="text-accent hover:underline">
            package
          </a>{" "}
          ·{" "}
          <a href={alpineLinks(p.alpine).source} className="text-accent hover:underline">
            source (aports)
          </a>
        </p>
      )}

      {hasExamples && (
        <>
          <h2 className="mt-10 font-mono text-[10px] uppercase tracking-wider text-fade">examples</h2>
          {runLine && (
            <div className="utility-surface mt-2 flex items-stretch border border-edge">
              <pre className="min-w-0 flex-1 overflow-x-auto px-4 py-3 font-mono text-sm leading-6"><code>
                <span className="text-accent">{runLine}</span>
              </code></pre>
              <CopyButton value={runLine} className="joined-control shrink-0 border-y-0 border-r-0" />
            </div>
          )}
          {memberBlock && (
            <div className="utility-surface mt-2 flex items-stretch border border-edge">
              <pre className="min-w-0 flex-1 overflow-x-auto px-4 py-3 font-mono text-sm leading-6"><code>
                <span className="text-accent whitespace-pre">{memberBlock}</span>
              </code></pre>
              <CopyButton value={memberBlock} className="joined-control shrink-0 border-y-0 border-r-0" />
            </div>
          )}
          {showDependencyExample && (
            <div className="utility-surface mt-2 flex items-stretch border border-edge">
              <pre className="min-w-0 flex-1 overflow-x-auto px-4 py-3 font-mono text-sm leading-6"><code>
                <span className="text-fade">[dependencies]</span>{"\n"}
                <span className="text-accent">{dependency}</span>
              </code></pre>
              <CopyButton value={`[dependencies]\n${dependency}`} className="joined-control shrink-0 border-y-0 border-r-0" />
            </div>
          )}
        </>
      )}

      {p.type === "stack" ? (
        members.length > 0 && (
          <>
            <h2 className="mt-10 font-mono text-[10px] uppercase tracking-wider text-fade">members</h2>
            <div className="mt-2 overflow-x-auto border border-edge">
              <table className="w-full min-w-2xl text-sm">
                <thead className="sr-only">
                  <tr><th>Member</th><th>Run</th><th>Params</th><th>References</th><th>Publish</th><th>After</th></tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.name} className="border-b border-edge last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-2 font-mono">{m.name}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-fade">{m.run}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {Object.entries(m.params).map(([k, v]) => `${k} = "${v}"`).join(", ")}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-fade">{m.refs.join(", ")}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-fade">{m.publish.join(", ")}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-fade">{m.after.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        paramRows(latest.params).length > 0 && (
          <>
            <h2 className="mt-10 font-mono text-[10px] uppercase tracking-wider text-fade">params</h2>
            <p className="mt-1 font-mono text-xs text-fade">reference as {"{"}{p.name}.&lt;name&gt;{"}"} from a stack; set with params = {"{ <name> = \"…\" }"}</p>
            <div className="mt-2 overflow-x-auto border border-edge">
              <table className="w-full text-sm">
                <tbody>
                  {paramRows(latest.params).map((r) => (
                    <tr key={r.name} className="border-b border-edge last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-2 font-mono">{r.name}</td>
                      <td className="px-4 py-2 font-mono text-xs text-fade">{r.kind}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.value ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 font-mono text-xs text-fade">set with params = {"{ … }"}; secrets are minted per stack unless external</p>
          </>
        )
      )}
      {(latest.publish || latest.volumes?.length || depsOf(latest).length > 0) && (
        <p className="mt-6 font-mono text-xs text-fade">
          {latest.publish && <span className="mr-4">publish: {latest.publish}</span>}
          {latest.volumes?.length ? <span className="mr-4">volumes: {latest.volumes.join(", ")}</span> : null}
          {depsOf(latest).length > 0 && <span>depends on: {depsOf(latest).map((d) => `${d.name} ${d.version}`).join(", ")}</span>}
        </p>
      )}
      {latest.manifest && (
        <p className="mt-2 font-mono text-xs text-fade">
          <a href={latest.manifest} className="text-accent hover:underline">ply.toml</a> — the manifest as published
        </p>
      )}
      {manifestText && (
        <details className="mt-6 border border-edge">
          <summary className="cursor-pointer px-4 py-2 font-mono text-xs text-fade">ply.toml (as published)</summary>
          <pre className="overflow-x-auto border-t border-edge px-4 py-3 font-mono text-xs leading-6">{manifestText}</pre>
        </details>
      )}

      <h2 className="mt-10 font-mono text-[10px] uppercase tracking-wider text-fade">versions</h2>
      <div className="mt-2 overflow-x-auto border border-edge">
      <table className="w-full min-w-lg text-sm">
        <thead className="sr-only">
          <tr><th>Version</th><th>Architecture</th><th>Verified</th><th>Size</th><th>Published</th></tr>
        </thead>
        <tbody>
          {[...p.versions].reverse().map((v) => (
            <tr key={`${v.version}-${archOf(v)}`} className="border-b border-edge last:border-b-0">
              <td className="whitespace-nowrap px-4 py-3 font-mono">{v.version}</td>
              <td className="px-4 py-2">
                <a
                  href={srcOf(v)}
                  className="secondary-action inline-flex min-h-8 items-center border border-edge px-2 font-mono text-[10px] text-fade transition-colors hover:border-accent hover:text-accent"
                >
                  {archOf(v)}
                </a>
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-fade">
                {v.verified === false ? <span title="bytes hosted by the publisher; sha256 reported by their ply">external</span> : ""}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-fade">{fmtSize(v.bytes)}</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-fade">
                {v.pushed_at?.slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </main>
  );
}
