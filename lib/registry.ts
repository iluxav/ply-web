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
  dependencies?: { name: string; version: string }[];
  apps?: StackApp[]; // for a stack version: the run sequence
};

// A stack member, as the catalog records it (mirrors a `[[app]]` block).
export type StackApp = {
  run: string;
  name?: string;
  e?: string[];
  after?: string[];
  publish?: string[];
  volume?: string[];
  domain?: string[];
  scale?: number;
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

export async function registryState(): Promise<RegistryState> {
  "use cache";
  cacheLife("minutes");
  const res = await fetch("https://registry.plybox.sh/state.json", {
    headers: { "User-Agent": "plybox-web" },
  });
  if (!res.ok) throw new Error(`state.json: HTTP ${res.status}`);
  return res.json();
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
