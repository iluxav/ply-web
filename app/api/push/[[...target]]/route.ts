// Publishing: `ply push` lands here, and so does plain curl. The CLI is a
// convenience, never a requirement — one key, one POST.
//
//   POST /api/push/<namespace>/<filename>   (bytes: the registry stores them)
//   Authorization: Bearer ply_…
//   body: the image
//
//   POST /api/push                          (same, filename in a header)
//   X-Ply-Filename: myapp-1.2.0-linux-x64.img
//
//   POST /api/push[/<namespace>]            (URL: the registry records, never stores)
//   Content-Type: application/json
//   body: {"url": "https://…/myapp-1.2.0-linux-x64.img"}
//   The server fetches the URL ONCE and hashes it — names are claims,
//   hashes are proof, and a catalog entry without a server-computed
//   sha256 would be a rumor. Bytes stay wherever the publisher hosts them.
//
// The namespace defaults to the key's GitHub login — yours by construction,
// no claims, no squatting. Publishing anywhere else (the official `ply` and
// `apps` shelves, a shared org) needs a `namespace_grants` row. The registry
// is append-only: a version's bytes never change. Bytes go to R2 at
// {owner}/{name}/, the catalog files regenerate, and the existing static
// read path picks the package up with zero new resolution code.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { userForToken } from "@/lib/auth";
import { canPublish, isReserved } from "@/lib/namespaces";
import { ready } from "@/lib/db";
import { putObject } from "@/lib/r2";
import { loadRecord, saveRecord } from "@/lib/records";
import { writeCatalogFiles, REGISTRY } from "@/lib/catalog-files";
import { manifestJson } from "@/lib/manifest";
import { acquireUploadSlot, checkPush, clientIp, failures, recordPush, refusalHeaders, refusesOrigin } from "@/lib/limits";


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

export async function POST(req: Request, ctx: { params: Promise<{ target?: string[] }> }) {
  const auth = req.headers.get("authorization") ?? "";
  // A bad token costs a lookup; an address that keeps sending them is told
  // to wait before the lookup, not after.
  const ip = clientIp(req);
  if (!failures.allow(ip)) {
    return NextResponse.json({ error: "too many requests with an invalid key — wait a minute" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const user = await userForToken(auth.replace(/^Bearer\s+/i, ""));
  if (!user) {
    failures.noteFailure(ip);
    return NextResponse.json(
      { error: "publish with a key: Authorization: Bearer ply_… (ply login, or plybox.sh/account)" },
      { status: 401 },
    );
  }

  // Two shapes, one handler:
  //   POST /api/push                          filename in X-Ply-Filename, owner = your login
  //   POST /api/push/<namespace>/<filename>   both in the path — the curl-able form
  const { target } = await ctx.params;
  const segments = (target ?? []).filter(Boolean);
  if (segments.length > 2) {
    return NextResponse.json(
      { error: "expected /api/push or /api/push/<namespace>/<filename>" },
      { status: 404 },
    );
  }
  const [pathNamespace, pathFilename] = segments;

  // URL mode: a JSON body names where the bytes already live
  let origin: { url: string; filename: string; name: string; version: string; arch: string } | null = null;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { url?: string } | null;
    if (!body?.url) return NextResponse.json({ error: "expected {\"url\": …}" }, { status: 400 });
    const parsed = parseOriginUrl(body.url);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    origin = parsed;
  }

  const filename =
    origin?.filename ??
    (pathFilename ? decodeURIComponent(pathFilename) : null) ??
    req.headers.get("x-ply-filename") ??
    "";
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
  // Your own username is yours by construction; any other namespace needs
  // a grant. An account that has not chosen a username publishes nowhere.
  if (!user.username && !pathNamespace) {
    return NextResponse.json(
      { error: "choose your username first at plybox.sh/account — it becomes your namespace" },
      { status: 409 },
    );
  }
  const owner = (pathNamespace ?? user.username ?? "").toLowerCase();
  if (!(await canPublish(user.id, user.username, owner))) {
    return NextResponse.json(
      {
        error: isReserved(owner)
          ? `\`${owner}\` is an official namespace — publishing there needs a grant`
          : `you cannot publish to \`${owner}\`${user.username ? ` — your namespace is \`${user.username}\`` : " — choose your username at plybox.sh/account"}`,
      },
      { status: 403 },
    );
  }

  // Client-derived catalog metadata (X-Ply-Meta) — the client reads the
  // image's own manifest + lockfile and sends the result; the server stores
  // it verbatim. The bytes' sha256 is what's proven; this is descriptive.
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

  // The account's budget, before a byte is read or a row written: rates,
  // the day's bytes, stored bytes, the namespace's size. A URL push also
  // has to point somewhere the registry is willing to fetch from.
  const kind = origin ? "url" : "upload";
  const [known] = await sql`SELECT 1 FROM packages WHERE owner = ${owner} AND name = ${name}`;
  const gate = await checkPush(sql, user, owner, kind, {
    incoming_bytes: Number(req.headers.get("content-length") ?? 0) || 0,
    new_package: !known,
  });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: refusalHeaders(gate) });
  if (origin) {
    const refused = await refusesOrigin(origin.url);
    if (refused) return NextResponse.json({ error: refused }, { status: 400 });
  }
  const release = origin ? null : acquireUploadSlot(user.id, gate.limits);
  if (!origin && !release) {
    return NextResponse.json(
      { error: `${gate.limits.concurrent_uploads === 1 ? "an upload" : `${gate.limits.concurrent_uploads} uploads`} from this account ${gate.limits.concurrent_uploads === 1 ? "is" : "are"} already in flight, or the registry is busy — try again in a moment` },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  }
  try {
    return await publish(req, sql, { user, owner, name, version, arch, filename, isStack, origin, meta, kind, budget: gate.remaining_bytes });
  } finally {
    release?.();
  }
}

type PushInput = {
  user: NonNullable<Awaited<ReturnType<typeof userForToken>>>;
  owner: string; name: string; version: string; arch: string; filename: string; isStack: boolean;
  origin: { url: string; filename: string; name: string; version: string; arch: string } | null;
  meta: Meta;
  kind: "upload" | "url";
  /// Bytes the account may still add today (and store, for an upload).
  budget: number;
};

/// The push proper, once the account has been allowed to make it.
async function publish(req: Request, sql: NonNullable<Awaited<ReturnType<typeof ready>>>, input: PushInput) {
  const { user, owner, name, version, arch, filename, isStack, origin, meta, kind, budget } = input;
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
  // The `versions` dup check above only sees what THIS route has ever
  // written. A v3 `/api/publish` can publish an artifact for this
  // version/arch without ever touching `versions` — check the record too,
  // before any bytes are hashed or stored, or this bridge would silently
  // replace it.
  const publishedRecord = await loadRecord(sql, owner, name, version);
  if (publishedRecord?.artifacts.some((a) => a.arch === arch)) {
    return NextResponse.json(
      { error: `${owner}/${name}@${version} (${arch}) is already published — the registry is append-only; bump the version` },
      { status: 409 },
    );
  }

  let total = 0;
  let sha256: string;
  let bytes: Buffer | null = null; // the uploaded bytes, kept only for the stack-toml bridge below
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
      if (total > budget) {
        return NextResponse.json({ error: "this fetch would exceed the account's bytes for today — try again tomorrow" }, { status: 429, headers: { "Retry-After": "3600" } });
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
      if (total > budget) {
        return NextResponse.json({ error: "this upload would exceed the account's bytes for today, or its storage — try again tomorrow, or ask for more" }, { status: 429, headers: { "Retry-After": "3600" } });
      }
      hash.update(value);
      chunks.push(Buffer.from(value));
    }
    if (total === 0) return NextResponse.json({ error: "empty body" }, { status: 400 });
    sha256 = hash.digest("hex");
    bytes = Buffer.concat(chunks);
    const key = `${owner}/${name}/${filename}`;
    await putObject(key, bytes, "application/octet-stream", "public, max-age=31536000, immutable");
  }

  await sql`
    INSERT INTO versions (package_id, version, arch, filename, bytes, sha256, origin, volumes, links, dependencies, apps)
    VALUES (${pkg.id}, ${version}, ${arch}, ${filename}, ${total}, ${sha256}, ${origin?.url ?? null},
            ${sql.json(meta.volumes)}, ${sql.json(meta.links)}, ${sql.json(meta.dependencies)}, ${sql.json(meta.apps)})`;
  await sql`INSERT INTO events (kind, owner, name, version) VALUES ('push', ${owner}, ${name}, ${version})`;

  // v3 bridge (one release): a manifest-less record so the catalog files —
  // now generated from records only — still list this version. The backfill
  // script fills manifest_toml in; the page says "re-push with ply ≥ 0.1.70".
  // A legacy STACK push is the one exception: its uploaded body IS the
  // stack's toml, so its bridge record carries a real manifest from the
  // start rather than staying manifest-less like an image push.
  const existing = await loadRecord(sql, owner, name, version);
  const artifact = isStack ? [] : [{ arch: arch as "x64" | "arm64", src: origin?.url ?? `${REGISTRY}/${owner}/${name}/${filename}`, sha256, bytes: total, verified: !origin }];
  const merged = existing ? [...existing.artifacts.filter((a) => a.arch !== arch), ...artifact] : artifact;
  let stackTomlText = "";
  let stackManifest: Record<string, unknown> = {};
  if (isStack && bytes) {
    stackTomlText = bytes.toString("utf8");
    try { stackManifest = manifestJson(stackTomlText); } catch { stackTomlText = ""; stackManifest = {}; }
  }
  await saveRecord(sql, {
    package_id: pkg.id, version, type: meta.type as "app" | "layer" | "stack",
    manifest_toml: isStack ? stackTomlText : (existing?.manifest_toml ?? ""),
    manifest: isStack ? stackManifest : (existing?.manifest ?? {}),
    published_by: user.id,
  }, merged);
  if (!origin && !isStack) await sql`INSERT INTO uploads (key, sha256, bytes, user_id) VALUES (${`${owner}/${name}/${filename}`}, ${sha256}, ${total}, ${user.id}) ON CONFLICT (key) DO NOTHING`;
  await recordPush(sql, user.id, kind, total);
  await writeCatalogFiles(sql, owner, name);

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
