// `ply push` lands here: raw image bytes, metadata in headers.
//
//   POST /api/push
//   Authorization: Bearer ply_…
//   X-Ply-Filename: myapp-1.2.0-linux-x64.img
//   body: the image
//
// The owner is the token's GitHub login — no claims, no squatting. The
// registry is append-only: a version's bytes never change. Bytes go to
// R2 at {owner}/{name}/, the catalog files regenerate, and the existing
// static read path picks the package up with zero new resolution code.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { userForToken } from "@/lib/auth";
import { ready } from "@/lib/db";
import { putObject } from "@/lib/r2";


const MAX_BYTES = 512 * 1024 * 1024;
const NAME_RE = /^([a-z0-9][a-z0-9-]*)-(\d+\.\d+\.\d+)-linux-(x64|arm64)\.img$/;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const user = await userForToken(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return NextResponse.json({ error: "log in first: ply login" }, { status: 401 });

  const filename = req.headers.get("x-ply-filename") ?? "";
  const m = NAME_RE.exec(filename);
  if (!m) {
    return NextResponse.json(
      { error: "filename must be <name>-<x.y.z>-linux-<x64|arm64>.img" },
      { status: 400 },
    );
  }
  const [, name, version, arch] = m;
  const owner = user.login.toLowerCase();

  const sql = await ready();
  if (!sql) return NextResponse.json({ error: "registry accounts are not enabled here" }, { status: 503 });

  const [pkg] = await sql`
    INSERT INTO packages (owner, name) VALUES (${owner}, ${name})
    ON CONFLICT (owner, name) DO UPDATE SET name = ${name}
    RETURNING id, owner`;
  const dup = await sql`
    SELECT 1 FROM versions WHERE package_id = ${pkg.id} AND version = ${version} AND arch = ${arch}`;
  if (dup.length > 0) {
    return NextResponse.json(
      { error: `${owner}/${name}@${version} (${arch}) is already published — the registry is append-only; bump the version` },
      { status: 409 },
    );
  }

  if (!req.body) return NextResponse.json({ error: "empty body" }, { status: 400 });
  const chunks: Buffer[] = [];
  const hash = createHash("sha256");
  let total = 0;
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
  const sha256 = hash.digest("hex");
  const body = Buffer.concat(chunks);

  const key = `${owner}/${name}/${filename}`;
  await putObject(key, body, "application/octet-stream", "public, max-age=31536000, immutable");

  await sql`
    INSERT INTO versions (package_id, version, arch, filename, bytes, sha256)
    VALUES (${pkg.id}, ${version}, ${arch}, ${filename}, ${total}, ${sha256})`;
  await sql`INSERT INTO events (kind, owner, name, version) VALUES ('push', ${owner}, ${name}, ${version})`;

  // regenerate this package's index + the owner's catalog — reads stay static
  const files = await sql`
    SELECT v.filename FROM versions v
    JOIN packages p ON p.id = v.package_id
    WHERE p.owner = ${owner} AND p.name = ${name}
    ORDER BY v.filename`;
  await putObject(
    `${owner}/${name}/index.json`,
    JSON.stringify(files.map((f) => f.filename)),
    "application/json",
    "public, max-age=60",
  );
  const catalog = await sql`
    SELECT p.name, p.type, p.description, p.license, p.homepage,
           v.version, v.filename, v.arch, v.bytes, v.created_at
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
    byName.get(row.name)!.versions.push({
      version: row.version, img: row.filename, arch: row.arch,
      path: `${owner}/${row.name}/${row.filename}`,
      bytes: Number(row.bytes), pushed_at: row.created_at,
    });
  }
  await putObject(
    `${owner}/state.json`,
    JSON.stringify({ updated: new Date().toISOString(), packages: [...byName.values()] }, null, 1),
    "application/json",
    "public, max-age=60",
  );

  return NextResponse.json({
    ok: true,
    published: `${owner}/${name}@${version}`,
    sha256,
    url: `https://registry.plybox.sh/${key}`,
    use: `app = "${name}"` + "\n" + `source = "https://registry.plybox.sh/${owner}/{package}"`,
  });
}
