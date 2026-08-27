// R2 over the S3 API — the site's write path into the registry bucket.
// Reads stay static (registry.plybox.sh); only pushes come through here.
// Credentials via env (the stack's env_file): R2_ACCOUNT_ID,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default the live one).
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

let client: S3Client | null | undefined;

export function r2() {
  if (client !== undefined) return client;
  const account = process.env.R2_ACCOUNT_ID;
  const key = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!account || !key || !secret) {
    client = null;
    return client;
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: key, secretAccessKey: secret },
  });
  return client;
}

export const BUCKET = process.env.R2_BUCKET ?? "ply-registry-deb";

export async function putObject(key: string, body: Buffer | string, contentType: string, cacheControl: string) {
  const c = r2();
  if (!c) throw new Error("registry writes are not enabled (no R2 credentials)");
  await c.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
  }));
}
