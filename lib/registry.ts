// The registry's machine-readable snapshot, cached server-side: visitors
// never download the raw state; the droplet refetches on a short lifetime.
import { cacheLife } from "next/cache";

export type RegistryVersion = {
  version: string;
  img: string | null; // null for a stack (no image of its own)
  arch?: "x64" | "arm64";
  // src is the v2 canonical location: a full, http-fetchable URL. `path` is
  // the pre-v2 field (a bare path under registry.plybox.sh), kept as a
  // fallback until the whole catalog is rebuilt.
  src?: string;
  path?: string;
  bytes: number;
  pushed_at: string;
  volumes?: string[];
  links?: string[];
  // v3: an object of name -> range. v2 (pre-transition) recorded an array
  // of {name, version} instead; both shapes render until the catalog turns
  // over. See `depsOf`, which normalizes either into the array form.
  dependencies?: Record<string, string> | { name: string; version: string }[];
  // manifest is the URL of the published ply.toml this version was derived
  // from — "the manifest is the record." Absent for a legacy (pre-v3) entry
  // that has no manifest to point at.
  manifest?: string;
  // false only for a legacy artifact whose bytes/sha256 came from the
  // publisher's own report rather than a manifest ply verified itself.
  verified?: boolean;
  publish?: string;
  params?: Record<string, unknown>;
};

// The download/fetch location for a version: the v2 `src` when present, else
// the pre-v2 registry path. A stack's src is its toml, not an image.
export const srcOf = (v: RegistryVersion): string =>
  v.src ?? (v.path ? `https://registry.plybox.sh/${v.path}` : "");

export type AlpineProvenance = {
  branch: string; // e.g. "v3.20"
  repo: string; // "main" | "community"
  apk: string; // Alpine package name
  origin: string; // source package (aports directory)
};

export type RegistryPackage = {
  namespace: string;
  owner?: string;
  type?: string; // "app" | "layer" | "stack"; missing = layer (pre-v2 metadata)
  name: string;
  description: string;
  license: string;
  homepage: string;
  alpine?: AlpineProvenance;
  versions: RegistryVersion[];
};

// Where an unmodified Alpine build came from: the package page and the
// aports recipe (APKBUILD, license file, source tarball reference).
export const alpineLinks = (a: AlpineProvenance) => ({
  package: `https://pkgs.alpinelinux.org/package/${a.branch}/${a.repo}/x86_64/${a.apk}`,
  source: `https://git.alpinelinux.org/aports/tree/${a.repo}/${a.origin}?h=${a.branch.replace(/^v/, "")}-stable`,
});

export type RegistryState = {
  updated: string;
  package_count: number;
  image_count: number;
  total_bytes: number;
  packages: RegistryPackage[];
};

export const archOf = (v: RegistryVersion): "x64" | "arm64" =>
  v.arch ?? (v.img?.endsWith("-arm64.img") ? "arm64" : "x64");

// `apps/` was a namespace chosen by TYPE: runnable packages went there,
// kegs to `ply/`. A package is <namespace>/<name>, and being runnable is a
// property it has (an entrypoint), not a place it lives — so the two were
// folded into one. The old copies are still SERVED, because a host released
// before the fold resolves bare names through apps/, but they are the same
// packages and must not be browsed as a second set.
const ALIAS_NS = "apps";

/// Drop an alias entry whose package also exists under `ply/`. Anything left
/// alone there is still shown: hiding a package nobody republished would be
/// worse than showing it under a deprecated name.
function dropFoldedAliases(packages: RegistryPackage[]): RegistryPackage[] {
  const official = new Set(
    packages.filter((p) => p.namespace === "ply").map((p) => p.name),
  );
  return packages.filter(
    (p) => p.namespace !== ALIAS_NS || !official.has(p.name),
  );
}

export async function registryState(): Promise<RegistryState> {
  "use cache";
  cacheLife("minutes");
  const res = await fetch("https://registry.plybox.sh/state.json", {
    headers: { "User-Agent": "plybox-web" },
  });
  if (!res.ok) throw new Error(`state.json: HTTP ${res.status}`);
  const state: RegistryState = await res.json();
  const packages = dropFoldedAliases(state.packages ?? []);
  return { ...state, packages, package_count: packages.length };
}

// Package pages are namespace-scoped so a community iluxav/notify and the
// curated apps/notify each get their own page; ply stays bare for the
// short URLs everything already links to.
export const pkgHref = (ns: string, name: string) =>
  ns === "ply"
    ? `/registry/${encodeURIComponent(name)}/`
    : `/registry/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/`;

export const findPackage = (state: RegistryState, slug: string[]) => {
  const [ns, name] = slug.length === 1 ? ["ply", slug[0]] : slug;
  if (slug.length > 2) return undefined;
  return (
    state.packages.find((x) => x.namespace === ns && x.name === name) ??
    // an /registry/apps/<name> link predates the fold — it names the same
    // package, which now lives under ply/
    (ns === ALIAS_NS
      ? state.packages.find((x) => x.namespace === "ply" && x.name === name)
      : undefined) ??
    // pre-namespace URLs for non-ply packages keep working (first match)
    (slug.length === 1 ? state.packages.find((x) => x.name === name) : undefined)
  );
};

// TOML: a bare key containing a dot is a nested table — quote such names
export const depLine = (p: RegistryPackage, range: string) => {
  const key = p.name.includes(".") ? `"${p.name}"` : p.name;
  return p.namespace === "ply"
    ? `${key} = "${range}"`
    : `${key} = { source = "${p.namespace}", version = "${range}" }`;
};

export const fmtSize = (b: number) =>
  !b ? "—"
  : b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + " GiB"
  : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + " MiB"
  : Math.round(b / 1024) + " KiB";

// A param declaration, as `derive()` records it in state.json, is either a
// plain default (string), a computed default (a string containing `{...}`
// interpolation), or a secret marker `{ secret: true, external?: boolean }`.
// A secret's value is never in state.json to begin with — this type just
// makes "no value" explicit at the render site too.
export type ParamRow = {
  name: string;
  kind: "default" | "computed" | "secret (minted)" | "secret (external)";
  value?: string;
};

export function paramRows(
  params: Record<string, unknown> | undefined,
): ParamRow[] {
  return Object.entries(params ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, v]) => {
      if (typeof v === "string")
        return v.includes("{")
          ? { name, kind: "computed" as const, value: v }
          : { name, kind: "default" as const, value: v };
      const t = (v ?? {}) as { secret?: boolean; external?: boolean };
      return {
        name,
        kind: t.external
          ? ("secret (external)" as const)
          : ("secret (minted)" as const),
      };
    });
}

// Normalizes both dependency shapes (see `RegistryVersion.dependencies`)
// into the v2 array form the page renders.
export const depsOf = (
  v: RegistryVersion,
): { name: string; version: string }[] =>
  Array.isArray(v.dependencies)
    ? v.dependencies
    : Object.entries(v.dependencies ?? {}).map(([name, version]) => ({
        name,
        version,
      }));
