// `ply push` lands here — two modes, one record shape:
//
//   POST /api/push                       (bytes: the registry stores them)
//   Authorization: Bearer ply_…
//   X-Ply-Filename: myapp-1.2.0-linux-x64.img
//   body: the image
//
//   POST /api/push                       (URL: the registry records, never stores)
//   Content-Type: application/json
//   body: {"url": "https://…/myapp-1.2.0-linux-x64.img"}
//   The server fetches the URL ONCE and hashes it — names are claims,
//   hashes are proof, and a catalog entry without a server-computed
//   sha256 would be a rumor. Bytes stay wherever the publisher hosts them.
//
// The owner is the token's GitHub login — no claims, no squatting. The
// registry is append-only: a version's bytes never change. Bytes go to
// R2 at {owner}/{name}/, the catalog files regenerate, and the existing
// static read path picks the package up with zero new resolution code.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { userForToken } from "@/lib/auth";
import { ready } from "@/lib/db";
import { getObject, putObject } from "@/lib/r2";


const MAX_BYTES = 512 * 1024 * 1024;
const MAX_ORIGIN_BYTES = 1024 * 1024 * 1024; // hashing someone's mislinked ISO is not our job
const NAME_RE = /^([a-z0-9][a-z0-9-]*)-(\d+\.\d+\.\d+)-linux-(x64|arm64)\.img$/;
// A stack is published as its toml template (no arch — stacks are arch-agnostic).
const STACK_RE = /^([a-z0-9][a-z0-9-]*)-(\d+\.\d+\.\d+)\.stack\.toml$/;

// A publishable origin URL: https, no query (signed links expire — a
// cataloged one is a future 404), no fragment, and a basename that obeys
// the same canonical filename rule as uploaded bytes.
export function parseOriginUrl(raw: string):
  | { url: string; filename: string; name: string; version: string; arch: string }
  | { error: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: "that is not a URL" };
  }
  if (u.protocol !== "https:") return { error: "origin URLs must be https" };
  if (u.search) return { error: "origin URLs must not carry a query string — signed links expire; publish the stable asset URL" };
  if (u.hash) return { error: "origin URLs must not carry a fragment" };
  const filename = decodeURIComponent(u.pathname.split("/").at(-1) ?? "");
  const m = NAME_RE.exec(filename);
  if (!m) return { error: "the URL must end in <name>-<x.y.z>-linux-<x64|arm64>.img" };
  return { url: u.toString(), filename, name: m[1], version: m[2], arch: m[3] };
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const user = await userForToken(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return NextResponse.json({ error: "log in first: ply login" }, { status: 401 });

  // URL mode: a JSON body names where the bytes already live
  let origin: { url: string; filename: string; name: string; version: string; arch: string } | null = null;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { url?: string } | null;
    if (!body?.url) return NextResponse.json({ error: "expected {\"url\": …}" }, { status: 400 });
    const parsed = parseOriginUrl(body.url);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    origin = parsed;
  }

  const filename = origin?.filename ?? req.headers.get("x-ply-filename") ?? "";
  const imgM = NAME_RE.exec(filename);
  const stackM = STACK_RE.exec(filename);
  let name: string, version: string, arch: string, isStack: boolean;
  if (imgM) {
    [, name, version, arch] = imgM;
    isStack = false;
  } else if (stackM && !origin) {
    // a stack is uploaded (its toml), never URL-referenced
    [, name, version] = stackM;
    arch = "any";
    isStack = true;
  } else {
    return NextResponse.json(
      {
        error:
          "filename must be <name>-<x.y.z>-linux-<x64|arm64>.img or <name>-<x.y.z>.stack.toml",
      },
      { status: 400 },
    );
  }
  const owner = user.login.toLowerCase();

  // Client-derived catalog metadata (X-Ply-Meta) — the client reads the
  // image's own manifest + lockfile and sends the result; the server stores
  // it verbatim. The bytes' sha256 is what's proven; this is descriptive.
  type StackApp = {
    run: string;
    name?: string;
    e?: string[];
    after?: string[];
    publish?: string[];
    volume?: string[];
    domain?: string[];
    scale?: number;
  };
  type Meta = {
    type: string;
    volumes: string[];
    links: string[];
    dependencies: { name: string; version: string }[];
    apps: StackApp[];
  };
  let meta: Meta = { type: "app", volumes: [], links: [], dependencies: [], apps: [] };
  try {
    const raw = req.headers.get("x-ply-meta");
    if (raw) {
      const p = JSON.parse(raw) as Partial<Meta>;
      meta = {
        type: ["app", "layer", "stack"].includes(p.type ?? "") ? (p.type as string) : "app",
        volumes: Array.isArray(p.volumes) ? p.volumes : [],
        links: Array.isArray(p.links) ? p.links : [],
        dependencies: Array.isArray(p.dependencies) ? p.dependencies : [],
        apps: Array.isArray(p.apps) ? (p.apps as StackApp[]) : [],
      };
    }
  } catch {
    /* malformed meta → app defaults; the bytes still publish */
  }
  // The filename is authoritative for stack-ness (a .stack.toml is a stack
  // even if the meta header went missing).
  if (isStack) meta.type = "stack";

  const sql = await ready();
  if (!sql) return NextResponse.json({ error: "registry accounts are not enabled here" }, { status: 503 });

  const [pkg] = await sql`
    INSERT INTO packages (owner, name, type) VALUES (${owner}, ${name}, ${meta.type})
    ON CONFLICT (owner, name) DO UPDATE SET type = ${meta.type}
    RETURNING id, owner`;
  const dup = await sql`
    SELECT 1 FROM versions WHERE package_id = ${pkg.id} AND version = ${version} AND arch = ${arch}`;
  if (dup.length > 0) {
    return NextResponse.json(
      { error: `${owner}/${name}@${version} (${arch}) is already published — the registry is append-only; bump the version` },
      { status: 409 },
    );
  }

  let total = 0;
  let sha256: string;
  if (origin) {
    // fetch the claimed bytes once: verify squashfs magic, hash, count.
    // Redirects are followed for the fetch; the ORIGINAL url is what we
    // record — redirect targets are ephemeral by design.
    const res = await fetch(origin.url, { redirect: "follow" }).catch(() => null);
    if (!res || !res.ok || !res.body) {
      return NextResponse.json({ error: `origin answered ${res?.status ?? "nothing"} — the URL must be publicly fetchable` }, { status: 400 });
    }
    const hash = createHash("sha256");
    let first: Buffer | null = null;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ORIGIN_BYTES) {
        return NextResponse.json({ error: "origin exceeds 1GiB" }, { status: 413 });
      }
      if (!first) {
        first = Buffer.from(value.slice(0, 4));
        if (first.length >= 4 && first.toString("latin1") !== "hsqs") {
          return NextResponse.json({ error: "that URL does not serve a ply image (no squashfs magic)" }, { status: 400 });
        }
      }
      hash.update(value);
    }
    if (total === 0) return NextResponse.json({ error: "origin served an empty file" }, { status: 400 });
    sha256 = hash.digest("hex");
  } else {
    if (!req.body) return NextResponse.json({ error: "empty body" }, { status: 400 });
    const chunks: Buffer[] = [];
    const hash = createHash("sha256");
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        return NextResponse.json({ error: "image exceeds 512MB" }, { status: 413 });
      }
      hash.update(value);
      chunks.push(Buffer.from(value));
    }
    if (total === 0) return NextResponse.json({ error: "empty body" }, { status: 400 });
    sha256 = hash.digest("hex");
    const key = `${owner}/${name}/${filename}`;
    await putObject(key, Buffer.concat(chunks), "application/octet-stream", "public, max-age=31536000, immutable");
  }

  await sql`
    INSERT INTO versions (package_id, version, arch, filename, bytes, sha256, origin, volumes, links, dependencies, apps)
    VALUES (${pkg.id}, ${version}, ${arch}, ${filename}, ${total}, ${sha256}, ${origin?.url ?? null},
            ${sql.json(meta.volumes)}, ${sql.json(meta.links)}, ${sql.json(meta.dependencies)}, ${sql.json(meta.apps)})`;
  await sql`INSERT INTO events (kind, owner, name, version) VALUES ('push', ${owner}, ${name}, ${version})`;

  // regenerate this package's index + the owner's catalog — reads stay static
  // index.json lists ONLY stored files — a phantom filename here would
  // lure the resolver into a guaranteed 404; URL versions live in the
  // catalogs, which carry their absolute origin
  const files = await sql`
    SELECT v.filename FROM versions v
    JOIN packages p ON p.id = v.package_id
    WHERE p.owner = ${owner} AND p.name = ${name} AND v.origin IS NULL
    ORDER BY v.filename`;
  await putObject(
    `${owner}/${name}/index.json`,
    JSON.stringify(files.map((f) => f.filename)),
    "application/json",
    "public, max-age=60",
  );
  const catalog = await sql`
    SELECT p.name, p.type, p.description, p.license, p.homepage,
           v.version, v.filename, v.arch, v.bytes, v.created_at, v.origin, v.sha256,
           v.volumes, v.links, v.dependencies, v.apps
    FROM packages p JOIN versions v ON v.package_id = p.id
    WHERE p.owner = ${owner}
    ORDER BY p.name, v.filename`;
  const byName = new Map<string, { namespace: string; owner: string; name: string; type: string; description: string; license: string; homepage: string; versions: object[] }>();
  for (const row of catalog) {
    if (!byName.has(row.name)) {
      byName.set(row.name, {
        namespace: owner, owner, name: row.name, type: row.type,
        description: row.description, license: row.license, homepage: row.homepage,
        versions: [],
      });
    }
    // src is the v2 canonical location — ALWAYS a full, http-fetchable URL:
    // the origin for URL versions, the registry URL for stored bytes (an
    // image, or the stack's toml). img/path/url are kept alongside it so the
    // current site reader still works. A stack has no image of its own.
    const isStackRow = row.type === "stack";
    const src = row.origin ?? `https://registry.plybox.sh/${owner}/${row.name}/${row.filename}`;
    const v: Record<string, unknown> = {
      version: row.version,
      img: isStackRow ? null : row.filename,
      ...(isStackRow ? {} : { arch: row.arch }),
      src,
      ...(row.origin ? { url: row.origin } : { path: `${owner}/${row.name}/${row.filename}` }),
      sha256: row.sha256,
      bytes: Number(row.bytes), pushed_at: row.created_at,
    };
    if (Array.isArray(row.volumes) && row.volumes.length) v.volumes = row.volumes;
    if (Array.isArray(row.links) && row.links.length) v.links = row.links;
    if (Array.isArray(row.dependencies) && row.dependencies.length) v.dependencies = row.dependencies;
    if (Array.isArray(row.apps) && row.apps.length) v.apps = row.apps;
    byName.get(row.name)!.versions.push(v);
  }
  const ownerPkgs = [...byName.values()];
  await putObject(
    `${owner}/state.json`,
    JSON.stringify({ updated: new Date().toISOString(), packages: ownerPkgs }, null, 1),
    "application/json",
    "public, max-age=60",
  );

  // The root catalog (browse page, `ply search` default) carries every
  // namespace. Each push replaces ONLY its own namespace's entries and
  // preserves the rest — the git pipeline owns apps/ and ply/ the same
  // way — serialized by an advisory lock so concurrent pushes can't
  // lose each other's merge.
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(771600)`;
    type Pkg = { namespace?: string; name?: string; versions?: { bytes?: number; version?: string }[] };
    let root: { packages?: Pkg[] } = {};
    try {
      root = JSON.parse((await getObject("state.json")) ?? "{}");
    } catch { /* first ever state: start empty */ }
    const kept = (root.packages ?? []).filter((p) => p.namespace !== owner);
    const packages = [...kept, ...(ownerPkgs as Pkg[])].sort((a, b) =>
      a.namespace === b.namespace
        ? (a.name ?? "").localeCompare(b.name ?? "")
        : (a.namespace ?? "").localeCompare(b.namespace ?? ""));
    const snapshot = {
      ...root,
      updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      package_count: packages.length,
      image_count: packages.reduce((n, p) => n + (p.versions?.length ?? 0), 0),
      total_bytes: packages.reduce((n, p) => n + (p.versions ?? []).reduce((m, v) => m + (v.bytes ?? 0), 0), 0),
      packages,
    };
    await putObject("state.json", JSON.stringify(snapshot, null, 1), "application/json", "public, max-age=300");
  });

  return NextResponse.json({
    ok: true,
    published: `${owner}/${name}@${version}`,
    sha256,
    stored: !origin,
    url: origin?.url ?? `https://registry.plybox.sh/${owner}/${name}/${filename}`,
    use: isStack
      ? `ply run ${owner}/${name}`
      : `app = "${name}"` + "\n" + `source = "https://registry.plybox.sh/${owner}/{package}"`,
  });
}
