// What one account may ask of the registry, and how fast. The write API is
// reachable straight from the internet, so the limits live here, next to
// the tables that already say who pushed what: `uploads` for stored bytes,
// `packages` for a namespace's size, `tokens` for keys, and `quota_events`
// (this module's own ledger) for the rates. Three tiers — an account in its
// first day, an ordinary one, and an admin — each a plain table of numbers
// with an env override, so tuning is a deploy, not a release.
//
// Two things must be instant and are therefore in memory of this one
// process: how many uploads are in flight (every upload is buffered whole,
// so this is the memory cap), and how many bad-token requests an address
// has sent (a 401 costs a database lookup; a flood of them is a database
// flood). Both reset on restart, which is fine: they guard the process.
import { lookup } from "node:dns/promises";
import type { Queryable } from "./db";

export type Tier = "new" | "normal" | "admin";

export type Limits = {
  /// Uploads one account may have in flight at once.
  concurrent_uploads: number;
  /// Pushes of any kind (upload, URL, publish) per rolling hour.
  pushes_per_hour: number;
  /// Bytes accepted per rolling day (uploads and URL fetches both count).
  bytes_per_day: number;
  /// Bytes this registry stores for the account, in total.
  stored_bytes: number;
  /// Packages a namespace may hold.
  packages_per_namespace: number;
  /// URL pushes per rolling hour — each one makes the server fetch a file.
  url_pushes_per_hour: number;
  /// Keys an account may hold.
  keys_per_account: number;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const DEFAULTS: Record<Tier, Limits> = {
  new: {
    concurrent_uploads: 1,
    pushes_per_hour: 10,
    bytes_per_day: 500 * MB,
    stored_bytes: 2 * GB,
    packages_per_namespace: 20,
    url_pushes_per_hour: 5,
    keys_per_account: 25,
  },
  normal: {
    concurrent_uploads: 2,
    pushes_per_hour: 60,
    bytes_per_day: 2 * GB,
    stored_bytes: 10 * GB,
    packages_per_namespace: 200,
    url_pushes_per_hour: 20,
    keys_per_account: 25,
  },
  admin: {
    concurrent_uploads: 4,
    pushes_per_hour: 600,
    bytes_per_day: 50 * GB,
    stored_bytes: 500 * GB,
    packages_per_namespace: 5000,
    url_pushes_per_hour: 200,
    keys_per_account: 200,
  },
};

/// Uploads in flight across every account: the process buffers each one
/// whole, so this is what bounds its memory.
export const SERVER_CONCURRENT_UPLOADS = 6;
/// An account is `new` for this long after it was created.
export const NEW_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;
/// Bad-token requests one address may make per minute before being told to
/// wait, without a database lookup.
export const UNAUTHENTICATED_PER_MINUTE = 30;

type Env = Record<string, string | undefined>;

/// The tier's numbers, with `PLY_LIMITS` on top — a JSON object keyed by
/// tier, holding only the fields to change:
///   PLY_LIMITS='{"admin":{"bytes_per_day":107374182400},"new":{"pushes_per_hour":5}}'
/// A field that is not a positive number is ignored, not applied.
export function limitsFor(tier: Tier, env: Env = process.env): Limits {
  const base = { ...DEFAULTS[tier] };
  const raw = env.PLY_LIMITS;
  if (!raw) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  const over = (parsed as Record<string, unknown> | null)?.[tier];
  if (!over || typeof over !== "object") return base;
  for (const key of Object.keys(base) as (keyof Limits)[]) {
    const v = (over as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) base[key] = v;
  }
  return base;
}

/// Admins are the logins in PLY_ADMIN_LOGINS (the same list that grants the
/// official namespaces), matched on either the GitHub login or the chosen
/// username. Everyone else is `new` for a day, then `normal`.
export function tierOf(
  user: { login: string; username: string | null; created_at?: Date | string | null },
  env: Env = process.env,
  now: number = Date.now(),
): Tier {
  const admins = (env.PLY_ADMIN_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const names = [user.login, user.username].filter((n): n is string => !!n).map((n) => n.toLowerCase());
  if (names.some((n) => admins.includes(n))) return "admin";
  const created = user.created_at ? new Date(user.created_at).getTime() : 0;
  if (created && now - created < NEW_ACCOUNT_AGE_MS) return "new";
  return "normal";
}

export type PushKind = "upload" | "url" | "publish";

export type Usage = {
  pushes_last_hour: number;
  url_pushes_last_hour: number;
  bytes_last_day: number;
  stored_bytes: number;
  packages_in_namespace: number;
  keys: number;
};

export type Refusal = { ok: false; status: 429; error: string; retry_after: number };
export type Allowed = { ok: true; tier: Tier; limits: Limits; remaining_bytes: number };

function mb(n: number) {
  return n >= GB ? `${(n / GB).toFixed(n % GB === 0 ? 0 : 1)} GB` : `${Math.round(n / MB)} MB`;
}

/// The decision, from numbers alone. `incoming_bytes` is what the request
/// says it carries (0 when unknown — the route checks again as bytes
/// arrive, against `remaining_bytes`). `new_package`: this push would add a
/// package to the namespace.
export function decide(
  kind: PushKind,
  tier: Tier,
  limits: Limits,
  usage: Usage,
  opts: { incoming_bytes?: number; new_package?: boolean } = {},
): Allowed | Refusal {
  const refuse = (error: string, retry_after: number): Refusal => ({ ok: false, status: 429, error, retry_after });
  const label = tier === "admin" ? "an admin account" : tier === "new" ? "an account in its first day" : "an account";
  if (usage.pushes_last_hour >= limits.pushes_per_hour) {
    return refuse(`${usage.pushes_last_hour} pushes in the last hour — the limit for ${label} is ${limits.pushes_per_hour}/h; try again later`, 600);
  }
  if (kind === "url" && usage.url_pushes_last_hour >= limits.url_pushes_per_hour) {
    return refuse(`${usage.url_pushes_last_hour} URL pushes in the last hour — the limit for ${label} is ${limits.url_pushes_per_hour}/h (each one makes the registry fetch a file)`, 600);
  }
  if (opts.new_package && usage.packages_in_namespace >= limits.packages_per_namespace) {
    return refuse(`this namespace holds ${usage.packages_in_namespace} packages — the limit for ${label} is ${limits.packages_per_namespace}; publish a new version of an existing one, or ask for more`, 3600);
  }
  const day_left = Math.max(0, limits.bytes_per_day - usage.bytes_last_day);
  const store_left = Math.max(0, limits.stored_bytes - usage.stored_bytes);
  const incoming = Math.max(0, opts.incoming_bytes ?? 0);
  if (kind !== "publish") {
    if (incoming > day_left || day_left === 0) {
      return refuse(`${mb(usage.bytes_last_day)} accepted in the last day — the limit for ${label} is ${mb(limits.bytes_per_day)}/day; try again tomorrow`, 3600);
    }
    if (kind === "upload" && (incoming > store_left || store_left === 0)) {
      return refuse(`this account stores ${mb(usage.stored_bytes)} — the limit for ${label} is ${mb(limits.stored_bytes)}; ask for more if you need it`, 3600);
    }
  }
  const remaining_bytes = kind === "upload" ? Math.min(day_left, store_left) : day_left;
  return { ok: true, tier, limits, remaining_bytes };
}

/// The account's usage, from the tables that already record it.
export async function usageOf(sql: Queryable, userId: number, owner: string): Promise<Usage> {
  const [q] = await sql<{ pushes: string; urls: string; bytes: string }[]>`
    SELECT
      count(*) FILTER (WHERE at > now() - interval '1 hour')                      AS pushes,
      count(*) FILTER (WHERE at > now() - interval '1 hour' AND kind = 'url')     AS urls,
      coalesce(sum(bytes) FILTER (WHERE at > now() - interval '1 day'), 0)       AS bytes
    FROM quota_events WHERE user_id = ${userId}`;
  const [s] = await sql<{ stored: string }[]>`
    SELECT coalesce(sum(bytes), 0) AS stored FROM uploads WHERE user_id = ${userId}`;
  const [p] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM packages WHERE owner = ${owner}`;
  const [k] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM tokens WHERE user_id = ${userId}`;
  return {
    pushes_last_hour: Number(q?.pushes ?? 0),
    url_pushes_last_hour: Number(q?.urls ?? 0),
    bytes_last_day: Number(q?.bytes ?? 0),
    stored_bytes: Number(s?.stored ?? 0),
    packages_in_namespace: Number(p?.n ?? 0),
    keys: Number(k?.n ?? 0),
  };
}

/// Tier, usage, decision — the one call a route makes before reading a body.
export async function checkPush(
  sql: Queryable,
  user: { id: number; login: string; username: string | null; created_at?: Date | string | null },
  owner: string,
  kind: PushKind,
  opts: { incoming_bytes?: number; new_package?: boolean } = {},
): Promise<Allowed | Refusal> {
  const tier = tierOf(user);
  const limits = limitsFor(tier);
  const usage = await usageOf(sql, user.id, owner);
  return decide(kind, tier, limits, usage, opts);
}

/// The ledger line, written once the push has been accepted and its bytes
/// counted. Nothing else reads the row's meaning; it is only ever summed.
export async function recordPush(sql: Queryable, userId: number, kind: PushKind, bytes: number) {
  await sql`INSERT INTO quota_events (user_id, kind, bytes) VALUES (${userId}, ${kind}, ${Math.max(0, bytes)})`;
}

/// Keys per account, checked where a key is minted.
export async function mayMintKey(sql: Queryable, user: { id: number; login: string; username: string | null; created_at?: Date | string | null }): Promise<Refusal | null> {
  const limits = limitsFor(tierOf(user));
  const [k] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM tokens WHERE user_id = ${user.id}`;
  const n = Number(k?.n ?? 0);
  if (n >= limits.keys_per_account) {
    return { ok: false, status: 429, error: `this account holds ${n} keys — the limit is ${limits.keys_per_account}; revoke one first (ply key ls / ply key rm, or plybox.sh/account)`, retry_after: 0 };
  }
  return null;
}

// ---- in-process state -------------------------------------------------

const inflight = new Map<number, number>();
let inflightTotal = 0;

/// A seat for one upload, or null when the account or the server is full.
/// Call the returned function when the bytes are done, success or not.
export function acquireUploadSlot(userId: number, limits: Limits, serverMax: number = SERVER_CONCURRENT_UPLOADS): (() => void) | null {
  const mine = inflight.get(userId) ?? 0;
  if (mine >= limits.concurrent_uploads || inflightTotal >= serverMax) return null;
  inflight.set(userId, mine + 1);
  inflightTotal += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (inflight.get(userId) ?? 1) - 1;
    if (n <= 0) inflight.delete(userId);
    else inflight.set(userId, n);
    inflightTotal = Math.max(0, inflightTotal - 1);
  };
}

/// For tests: what is in flight right now.
export function inflightUploads(): { total: number; accounts: number } {
  return { total: inflightTotal, accounts: inflight.size };
}

/// Bad-token requests per address, a sliding minute. `allow` asks whether
/// this address may cost a lookup; `noteFailure` records that it did and
/// the token was bad. Successful requests are never counted.
export class FailureWindow {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly perMinute: number = UNAUTHENTICATED_PER_MINUTE,
    private readonly windowMs: number = 60_000,
  ) {}
  allow(ip: string, now: number = Date.now()): boolean {
    const recent = this.recent(ip, now);
    return recent.length < this.perMinute;
  }
  noteFailure(ip: string, now: number = Date.now()) {
    const recent = this.recent(ip, now);
    recent.push(now);
    this.hits.set(ip, recent);
    // Bounded: a flood of distinct addresses must not grow this forever.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) {
        if (v.length === 0 || now - v[v.length - 1] > this.windowMs) this.hits.delete(k);
      }
    }
  }
  private recent(ip: string, now: number): number[] {
    const list = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length === 0) this.hits.delete(ip);
    return list;
  }
}

export const failures = new FailureWindow();

/// The address a request came from: the first hop in X-Forwarded-For (the
/// edge on this host sets it), else the socket's own header, else nothing
/// — and "nothing" shares one bucket, which is the safe direction.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// ---- where a URL push may point --------------------------------------

/// True for addresses the registry must never fetch on a user's behalf:
/// loopback, private ranges (which include the ply bridge), link-local
/// (cloud metadata lives there), carrier-grade NAT, and the unspecified
/// address. IPv4-mapped IPv6 is judged by its IPv4 half.
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(v6)) return true; // fe80::/10
  return false;
}

/// Why a URL may not be fetched, or null when it may: a host the registry
/// itself uses, or one that resolves to a private address.
export async function refusesOrigin(url: string, resolve: (host: string) => Promise<string[]> = resolveAll): Promise<string | null> {
  const host = new URL(url).hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".ply") || host.endsWith(".internal")) {
    return `the registry will not fetch from \`${host}\``;
  }
  if (isPrivateIp(host.replace(/^\[|\]$/g, ""))) return `the registry will not fetch from a private address (${host})`;
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch {
    return `\`${host}\` does not resolve`;
  }
  if (addrs.length === 0) return `\`${host}\` does not resolve`;
  const bad = addrs.find(isPrivateIp);
  if (bad) return `\`${host}\` resolves to a private address (${bad}) — the registry will not fetch it`;
  return null;
}

async function resolveAll(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true });
  return rows.map((r) => r.address);
}

/// The 429 body every refusal shares. `Retry-After` is advisory: the
/// windows are rolling, so "later" is honest.
export function refusalHeaders(r: Refusal): Record<string, string> {
  return r.retry_after > 0 ? { "Retry-After": String(r.retry_after) } : {};
}
