import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  registryState,
  archOf,
  fmtSize,
  type RegistryPackage,
  type RegistryState,
} from "@/lib/registry";
import {
  RegistryTable,
  type RegistryRow,
} from "@/components/RegistryTable";
import { RegistryPagination } from "@/components/RegistryPagination";
import { RegistryCode } from "@/components/RegistryUI";
import styles from "@/components/Registry.module.css";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata, SITE_URL } from "@/lib/site";

const PAGE_SIZE = 100;
const DEFAULT_SOURCE = 'default = "https://registry.plybox.sh/ply/{package}"';

type RegistrySearchParams = {
  page?: string | string[];
  q?: string | string[];
  f?: string | string[];
};

type RegistryPageProps = {
  searchParams: Promise<RegistrySearchParams>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requestedPage(params: RegistrySearchParams) {
  const value = Number.parseInt(first(params.page) ?? "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function searchQuery(params: RegistrySearchParams) {
  return (first(params.q) ?? "").trim().slice(0, 120);
}

// Filters cut by the metadata every package carries: its type, and whether
// it lives outside the curated `ply` namespace. Type is a TAG here, never an
// address — which is why `apps/` stopped being a namespace of its own.
const FILTERS = ["all", "apps", "layers", "stacks", "community"] as const;
type Filter = (typeof FILTERS)[number];

function filterOf(params: RegistrySearchParams): Filter {
  const value = first(params.f) ?? "all";
  return (FILTERS as readonly string[]).includes(value) ? (value as Filter) : "all";
}

const typeOf = (pkg: RegistryPackage) => pkg.type ?? "layer";
const isCommunity = (pkg: RegistryPackage) => pkg.namespace !== "ply";

function matchesFilter(pkg: RegistryPackage, filter: Filter) {
  switch (filter) {
    case "apps": return typeOf(pkg) === "app";
    case "layers": return typeOf(pkg) === "layer";
    case "stacks": return typeOf(pkg) === "stack";
    case "community": return isCommunity(pkg);
    default: return true;
  }
}

function registryUrl(page: number, query = "", filter: Filter = "all") {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filter !== "all") params.set("f", filter);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/registry/?${suffix}` : "/registry/";
}

function matchesSearch(pkg: RegistryPackage, query: string) {
  if (!query) return true;
  const searchable = [
    pkg.namespace,
    pkg.name,
    pkg.description,
    pkg.license,
    ...pkg.versions.map((version) => `${version.version} ${archOf(version)}`),
  ]
    .join(" ")
    .toLowerCase();
  return searchable.includes(query.toLowerCase());
}

function packageRow(pkg: RegistryPackage): RegistryRow {
  const latest = pkg.versions[pkg.versions.length - 1];
  const architectures = [
    ...new Set(
      pkg.versions
        .filter((version) => version.version === latest.version)
        .map(archOf),
    ),
  ].sort((a, b) => b.localeCompare(a));

  return {
    name: pkg.name,
    namespace: pkg.namespace,
    type: typeOf(pkg),
    community: isCommunity(pkg),
    description: pkg.description,
    license: pkg.license,
    version: latest.version,
    architectures: pkg.type === "stack" ? [] : architectures,
    size: fmtSize(latest.bytes),
  };
}

export async function generateMetadata({
  searchParams,
}: RegistryPageProps): Promise<Metadata> {
  const params = await searchParams;
  const page = requestedPage(params);
  const query = searchQuery(params);
  const title = query
    ? `package search: ${query}`
    : page > 1
      ? `packages — page ${page}`
      : "packages";

  return pageMetadata({
    title,
    description:
      "The official ply package registry — content-addressed container images served as ordinary files.",
    path: query ? "/registry/" : registryUrl(page),
    noIndex: Boolean(query),
    alternateTypes: {
      "application/json": "https://registry.plybox.sh/state.json",
    },
  });
}

async function RegistryCatalog({
  state,
  searchParams,
}: {
  state: RegistryState;
  searchParams: Promise<RegistrySearchParams>;
}) {
  const params = await searchParams;
  const page = requestedPage(params);
  const query = searchQuery(params);
  const filter = filterOf(params);
  const searched = state.packages.filter(
    (pkg) => pkg.versions.length > 0 && matchesSearch(pkg, query),
  );
  const countOf = (f: Filter) => searched.filter((pkg) => matchesFilter(pkg, f)).length;
  const packages = searched.filter((pkg) => matchesFilter(pkg, filter));
  const pageCount = Math.max(1, Math.ceil(packages.length / PAGE_SIZE));

  if (page > pageCount) notFound();

  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, packages.length);
  const rows = packages.slice(start, end).map(packageRow);

  return (
    <section className={styles.catalog} aria-labelledby="package-index-title">
        <form action="/registry/" method="get" role="search">
          {filter !== "all" && <input type="hidden" name="f" value={filter} />}
          <label htmlFor="package-search" className={styles.searchLabel}>
            Find a package
          </label>
          <div className={styles.search}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
            <input
              id="package-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search name, version, license…"
              autoComplete="off"
            />
            <button
              type="submit"
            >
              Search
            </button>
          </div>
        </form>

      <div className={styles.filterBar}>
        <nav aria-label="Package filters" className={styles.filters}>
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={registryUrl(1, query, f)}
              aria-current={f === filter ? "page" : undefined}
            >
              {f === "all" ? "All packages" : f[0].toUpperCase() + f.slice(1)}
              <span>{countOf(f)}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.resultCount}>
          <p id="package-index-title">
            {packages.length === 0
              ? "0 packages"
              : `showing ${start + 1}–${end} of ${packages.length}`}
          </p>
          {(query || filter !== "all") && (
            <Link href="/registry/" className="text-accent hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <RegistryTable rows={rows} />
          <RegistryPagination page={page} pageCount={pageCount} query={query} filter={filter} />
        </>
      ) : (
        <div className={styles.empty}>
          <h3>No matching packages.</h3>
          <p>Try a different name or version{filter !== "all" ? ", or choose another package type" : ""}.</p>
          <Link href="/registry/">
            Clear search & filters →
          </Link>
        </div>
      )}
      <div className={styles.catalogNote}>
        <span>Apps run. Layers provide files. Stacks compose apps.</span>
        <a href="https://registry.plybox.sh/state.json">View raw index ↗</a>
      </div>
    </section>
  );
}

function CatalogFallback() {
  return (
    <div className="mt-12 border-y border-edge py-12 font-mono text-xs text-fade">
      loading package index…
    </div>
  );
}

export default async function RegistryPage({ searchParams }: RegistryPageProps) {
  const state = await registryState();

  return (
    <main className={styles.page}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "@id": `${SITE_URL}/registry/#catalog`,
          name: "ply package registry",
          description:
            "The official catalog of content-addressed packages for ply.",
          url: `${SITE_URL}/registry/`,
          inLanguage: "en",
          isPartOf: { "@id": `${SITE_URL}/#website` },
          mainEntity: {
            "@type": "ItemList",
            name: "ply packages",
            numberOfItems: state.package_count,
          },
        }}
      />
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>The ply package index</p>
          <h1>
            <span className={styles.slash}>/</span>registry<span className={styles.slash}>_</span>
          </h1>
          <p className={styles.intro}>
            Small pieces. Your composition.<br />
            Discover apps, runtimes, and libraries. Pin what you need.
            Everything ships as a file.
          </p>
        </div>

        <div className={styles.source}>
          <RegistryCode title="ply.toml / registry source" value={`[sources]\n${DEFAULT_SOURCE}`} />
          <p>One source. Ordinary HTTP. <Link href="/docs/quickstart/">Get started →</Link></p>
        </div>
      </header>
      <div className={styles.stats}>
        <span><strong>{state.package_count}</strong> packages</span>
        <span><strong>{state.image_count}</strong> images</span>
        <span><strong>{fmtSize(state.total_bytes)}</strong> total</span>
        <span className={styles.updated}>Index updated {state.updated.slice(0, 16).replace("T", " ")} UTC</span>
      </div>

      <Suspense fallback={<CatalogFallback />}>
        <RegistryCatalog state={state} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
