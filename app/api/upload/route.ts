// Bytes are mechanical. This stores an image under {owner}/{name}/ and hands
// back the src a publish may cite as verified. Nothing is cataloged here.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { userForToken } from "@/lib/auth";
import { canPublish, isOwnerSegment } from "@/lib/namespaces";
import { ready } from "@/lib/db";
import { putObject } from "@/lib/r2";
import { REGISTRY } from "@/lib/catalog-files";

const MAX_BYTES = 512 * 1024 * 1024;
const NAME_RE = /^([a-z0-9][a-z0-9-]*)-(\d+\.\d+\.\d+)-linux-(x64|arm64)\.img$/;

export async function POST(req: Request) {
  const user = await userForToken((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!user) return NextResponse.json({ error: "publish with a key: Authorization: Bearer ply_…" }, { status: 401 });
  const filename = req.headers.get("x-ply-filename") ?? "";
  const m = NAME_RE.exec(filename);
  if (!m) return NextResponse.json({ error: "X-Ply-Filename must be <name>-<x.y.z>-linux-<x64|arm64>.img" }, { status: 400 });
  const owner = (req.headers.get("x-ply-namespace") ?? user.username ?? "").toLowerCase();
  if (!owner) return NextResponse.json({ error: "choose your username first at plybox.sh/account" }, { status: 409 });
  // Before the key is built: the owner is its first segment.
  if (!isOwnerSegment(owner)) return NextResponse.json({ error: "namespaces are lowercase [a-z0-9-], starting with a letter or digit" }, { status: 400 });
  if (!(await canPublish(user.id, user.username, owner))) return NextResponse.json({ error: `you cannot publish to \`${owner}\`` }, { status: 403 });
  const sql = await ready();
  if (!sql) return NextResponse.json({ error: "registry accounts are not enabled here" }, { status: 503 });
  if (!req.body) return NextResponse.json({ error: "empty body" }, { status: 400 });

  const chunks: Buffer[] = []; const hash = createHash("sha256"); let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) return NextResponse.json({ error: "image exceeds 512MB" }, { status: 413 });
    hash.update(value); chunks.push(Buffer.from(value));
  }
  if (total === 0) return NextResponse.json({ error: "empty body" }, { status: 400 });
  const sha256 = hash.digest("hex");
  const claimed = req.headers.get("x-ply-sha256");
  if (claimed && claimed !== sha256) return NextResponse.json({ error: `sha256 mismatch: you said ${claimed.slice(0, 12)}…, the bytes are ${sha256.slice(0, 12)}…` }, { status: 400 });

  // Insert first, store second: the `uploads` row is the lock. Whoever's
  // INSERT lands claims the key and does the (only) putObject; a loser never
  // writes R2 at all — it just checks whether the winner's bytes match.
  const key = `${owner}/${m[1]}/${filename}`;
  const [won] = await sql`
    INSERT INTO uploads (key, sha256, bytes, user_id) VALUES (${key}, ${sha256}, ${total}, ${user.id})
    ON CONFLICT (key) DO NOTHING
    RETURNING sha256`;
  if (won) {
    try {
      await putObject(key, Buffer.concat(chunks), "application/octet-stream", "public, max-age=31536000, immutable");
    } catch (e) {
      await sql`DELETE FROM uploads WHERE key = ${key}`;
      throw e;
    }
  } else {
    const [existing] = await sql`SELECT sha256 FROM uploads WHERE key = ${key}`;
    if (!existing || existing.sha256 !== sha256) {
      return NextResponse.json({ error: `${filename} already exists under ${owner}/ with different bytes — bump the version` }, { status: 409 });
    }
  }
  return NextResponse.json({ src: `${REGISTRY}/${key}`, sha256, bytes: total, verified: true });
}
