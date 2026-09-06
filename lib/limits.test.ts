import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  FailureWindow,
  acquireUploadSlot,
  decide,
  inflightUploads,
  isPrivateIp,
  limitsFor,
  refusesOrigin,
  tierOf,
  type Usage,
} from "./limits";

const quiet: Usage = { pushes_last_hour: 0, url_pushes_last_hour: 0, bytes_last_day: 0, stored_bytes: 0, packages_in_namespace: 0, keys: 0 };
const GB = 1024 * 1024 * 1024;

describe("tierOf", () => {
  const env = { PLY_ADMIN_LOGINS: "iluxav, Someone" };
  const day = 24 * 60 * 60 * 1000;
  it("names an admin by GitHub login or chosen username, case-insensitively", () => {
    expect(tierOf({ login: "IluxaV", username: "x", created_at: new Date() }, env)).toBe("admin");
    expect(tierOf({ login: "other", username: "someone", created_at: new Date() }, env)).toBe("admin");
  });
  it("treats an account as new for its first day, then normal", () => {
    const now = Date.now();
    expect(tierOf({ login: "a", username: "a", created_at: new Date(now - day / 2) }, env, now)).toBe("new");
    expect(tierOf({ login: "a", username: "a", created_at: new Date(now - day - 1) }, env, now)).toBe("normal");
    expect(tierOf({ login: "a", username: null }, env, now)).toBe("normal");
  });
});

describe("limitsFor", () => {
  it("applies PLY_LIMITS per tier and ignores nonsense", () => {
    const env = { PLY_LIMITS: '{"admin":{"bytes_per_day":1,"pushes_per_hour":"lots","keys_per_account":-3},"new":{"pushes_per_hour":3}}' };
    expect(limitsFor("admin", env)).toEqual({ ...DEFAULTS.admin, bytes_per_day: 1 });
    expect(limitsFor("new", env)).toEqual({ ...DEFAULTS.new, pushes_per_hour: 3 });
    expect(limitsFor("normal", env)).toEqual(DEFAULTS.normal);
    expect(limitsFor("normal", { PLY_LIMITS: "not json" })).toEqual(DEFAULTS.normal);
  });
});

describe("decide", () => {
  const normal = DEFAULTS.normal;
  it("lets a quiet account push and reports what is left of the day", () => {
    const r = decide("upload", "normal", normal, quiet, { incoming_bytes: 50_000_000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.remaining_bytes).toBe(2 * GB);
  });
  it("refuses at the hourly push limit with a 429 and a reason naming the tier", () => {
    const r = decide("publish", "new", DEFAULTS.new, { ...quiet, pushes_last_hour: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(429);
      expect(r.error).toMatch(/10 pushes.*first day.*10\/h/);
      expect(r.retry_after).toBeGreaterThan(0);
    }
  });
  it("counts URL pushes separately, because each one costs a fetch", () => {
    const r = decide("url", "normal", normal, { ...quiet, url_pushes_last_hour: 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/URL pushes/);
    expect(decide("upload", "normal", normal, { ...quiet, url_pushes_last_hour: 20 }).ok).toBe(true);
  });
  it("refuses a new package past the namespace size, never a new version", () => {
    const full = { ...quiet, packages_in_namespace: 200 };
    expect(decide("upload", "normal", normal, full, { new_package: true }).ok).toBe(false);
    expect(decide("upload", "normal", normal, full, { new_package: false }).ok).toBe(true);
  });
  it("refuses bytes past the day's budget or the stored total, and tells which", () => {
    const busy = { ...quiet, bytes_last_day: 2 * GB - 1 };
    const r = decide("upload", "normal", normal, busy, { incoming_bytes: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/per day|\/day/);
    const heavy = { ...quiet, stored_bytes: 10 * GB };
    const s = decide("upload", "normal", normal, heavy, { incoming_bytes: 1 });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toMatch(/stores/);
    // a URL push counts against the day, not the store (bytes stay elsewhere)
    expect(decide("url", "normal", normal, heavy, { incoming_bytes: 1 }).ok).toBe(true);
    // a publish carries no bytes and is never refused for them
    expect(decide("publish", "normal", normal, { ...busy, stored_bytes: 10 * GB }).ok).toBe(true);
  });
  it("gives an admin the admin numbers, which are larger, not infinite", () => {
    const r = decide("upload", "admin", DEFAULTS.admin, { ...quiet, pushes_last_hour: 100 });
    expect(r.ok).toBe(true);
    expect(decide("upload", "admin", DEFAULTS.admin, { ...quiet, pushes_last_hour: 600 }).ok).toBe(false);
  });
});

describe("acquireUploadSlot", () => {
  it("seats up to the account's concurrency, then the server's, and frees on release", () => {
    const limits = { ...DEFAULTS.normal, concurrent_uploads: 2 };
    const a1 = acquireUploadSlot(1, limits, 3);
    const a2 = acquireUploadSlot(1, limits, 3);
    expect(a1 && a2).toBeTruthy();
    expect(acquireUploadSlot(1, limits, 3)).toBeNull(); // the account is full
    const b1 = acquireUploadSlot(2, limits, 3);
    expect(b1).toBeTruthy();
    expect(acquireUploadSlot(3, limits, 3)).toBeNull(); // the server is full
    expect(inflightUploads()).toEqual({ total: 3, accounts: 2 });
    a1!(); a1!(); // releasing twice releases once
    expect(inflightUploads().total).toBe(2);
    a2!(); b1!();
    expect(inflightUploads()).toEqual({ total: 0, accounts: 0 });
  });
});

describe("FailureWindow", () => {
  it("allows an address until its failures fill the minute, then again after it rolls", () => {
    const w = new FailureWindow(3, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(w.allow("1.2.3.4", t0 + i)).toBe(true);
      w.noteFailure("1.2.3.4", t0 + i);
    }
    expect(w.allow("1.2.3.4", t0 + 10)).toBe(false);
    expect(w.allow("5.6.7.8", t0 + 10)).toBe(true);
    expect(w.allow("1.2.3.4", t0 + 60_001)).toBe(true);
  });
});

describe("isPrivateIp / refusesOrigin", () => {
  it("knows the ranges the registry must never fetch", () => {
    for (const ip of ["127.0.0.1", "10.77.0.1", "172.16.5.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["1.1.1.1", "64.23.144.72", "172.15.0.1", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
  it("refuses registry-internal names, literal private addresses, and names that resolve to them", async () => {
    const resolve = async (host: string) => (host === "evil.example" ? ["93.184.216.34", "10.77.0.2"] : ["93.184.216.34"]);
    expect(await refusesOrigin("https://plybox-db.ply/x.img", resolve)).toMatch(/\.ply/);
    expect(await refusesOrigin("https://localhost/x.img", resolve)).toMatch(/localhost/);
    expect(await refusesOrigin("https://169.254.169.254/x.img", resolve)).toMatch(/private address/);
    expect(await refusesOrigin("https://evil.example/x.img", resolve)).toMatch(/resolves to a private address \(10.77.0.2\)/);
    expect(await refusesOrigin("https://good.example/x.img", resolve)).toBeNull();
    expect(await refusesOrigin("https://nowhere.example/x.img", async () => { throw new Error("ENOTFOUND"); })).toMatch(/does not resolve/);
  });
});
