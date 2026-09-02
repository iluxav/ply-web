import { describe, expect, it } from "vitest";
import { indexFilenames, ownerPackages, REGISTRY, tomlUrl, versionEntries } from "./catalog-files";
import { manifestJson, type StoredRecord } from "./manifest";

const PG = `[package]\nname = "postgres"\nversion = "17.10.7"\ndescription = "db"\nentrypoint = ["./run.sh"]\n[ports]\ndb = 5432\n[params]\nuser = "postgres"\n`;
const rec = (over: Partial<StoredRecord> = {}): StoredRecord => ({
  owner: "ply", name: "postgres", version: "17.10.7", type: "app", manifest_toml: PG, manifest: manifestJson(PG),
  artifacts: [
    { arch: "x64", src: "https://registry.plybox.sh/ply/postgres/postgres-17.10.7-linux-x64.img", sha256: "aa", bytes: 10, verified: true },
    { arch: "arm64", src: "https://cdn.example.com/pg-arm64.img", sha256: "bb", bytes: 11, verified: false },
  ],
  pushed_at: "2026-09-02T15:51:37.000Z", published_by: "iluxav", ...over,
});

describe("versionEntries", () => {
  it("emits one v3 entry per artifact with the derived fields", () => {
    const [x64, arm] = versionEntries(rec());
    expect(x64).toMatchObject({
      version: "17.10.7", arch: "x64", img: "postgres-17.10.7-linux-x64.img",
      src: "https://registry.plybox.sh/ply/postgres/postgres-17.10.7-linux-x64.img", sha256: "aa", bytes: 10,
      pushed_at: "2026-09-02T15:51:37.000Z", manifest: tomlUrl("ply", "postgres", "17.10.7"), verified: true,
      publish: "internal:5432", params: { user: "postgres" },
    });
    expect(arm).toMatchObject({ arch: "arm64", img: "pg-arm64.img", verified: false });
    expect(x64).not.toHaveProperty("apps");
  });
  it("emits one image-less entry for a stack whose src is its toml", () => {
    const st = `[stack]\nname = "todos"\nversion = "0.1.0"\n[[app]]\nrun = "postgres@17"\n`;
    const [e] = versionEntries(rec({ name: "todos", version: "0.1.0", type: "stack", manifest_toml: st, manifest: manifestJson(st), artifacts: [] }));
    expect(e).toMatchObject({ img: null, src: tomlUrl("ply", "todos", "0.1.0"), manifest: tomlUrl("ply", "todos", "0.1.0"), bytes: 0 });
    expect(e.arch).toBeUndefined();
  });
  it("omits the manifest url for a legacy record without one", () => {
    const [e] = versionEntries(rec({ manifest_toml: "", manifest: {} }));
    expect(e).not.toHaveProperty("manifest");
  });
  it("writes dependencies in the v2 array shape, so a released CLI still parses state.json", () => {
    // The wire shape is additive-only: ply 0.1.68 declares
    // `dependencies: Vec<Dep>` and parses state.json in ONE from_str, so an
    // object here fails the whole document — every `ply search`/`add`/`up`.
    const deps = PG.replace("[ports]", '[dependencies]\npostgresql17 = "17"\nrclone = { version = "1.60" }\n[ports]');
    const [e] = versionEntries(rec({ manifest_toml: deps, manifest: manifestJson(deps) }));
    expect(e.dependencies).toEqual([{ name: "postgresql17", version: "17" }, { name: "rclone", version: "1.60" }]);
  });
  it("takes the last path segment of a src literally — R2 keys are not percent-decoded", () => {
    const src = "https://cdn.example.com/pg-100%-arm64.img";
    const [, arm] = versionEntries(rec({ artifacts: [rec().artifacts[0], { ...rec().artifacts[1], src }] }));
    expect(arm.img).toBe("pg-100%-arm64.img");
  });
  it("points a legacy stack's src at the uploaded .stack.toml, not the nonexistent v3 .toml", () => {
    const [e] = versionEntries(rec({
      name: "todos", version: "0.1.0", type: "stack", manifest_toml: "", manifest: {}, artifacts: [],
    }));
    expect(e.src).toBe(`${REGISTRY}/ply/todos/todos-0.1.0.stack.toml`);
    expect(e).not.toHaveProperty("manifest");
  });
});

describe("ownerPackages", () => {
  it("groups records by name and reads package fields from the manifest", () => {
    const pkgs = ownerPackages([rec(), rec({ version: "17.10.6", pushed_at: "2026-08-30T00:00:00.000Z" })]);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]).toMatchObject({ namespace: "ply", owner: "ply", name: "postgres", type: "app", description: "db" });
    expect(pkgs[0].versions.map((v) => v.version)).toEqual(["17.10.6", "17.10.6", "17.10.7", "17.10.7"]);
  });
  it("falls back to the package columns while a seeded record's manifest is still empty", () => {
    // Rollout window: boot-seeded records carry `manifest {}`, so the only
    // description/license/homepage anywhere is the `packages` row the
    // legacy push wrote. Losing them for the hours between deploy and
    // backfill would empty every pre-v3 listing.
    const seeded = rec({
      manifest_toml: "", manifest: {},
      description: "PostgreSQL relational database", license: "PostgreSQL", homepage: "https://www.postgresql.org",
    });
    expect(ownerPackages([seeded])[0]).toMatchObject({
      description: "PostgreSQL relational database", license: "PostgreSQL", homepage: "https://www.postgresql.org",
    });
  });
  it("prefers the manifest field over the package column, per field", () => {
    // PG's manifest declares `description` but neither license nor homepage,
    // so the manifest wins where it speaks and the columns fill the rest.
    const both = rec({ description: "stale row", license: "PostgreSQL", homepage: "https://www.postgresql.org" });
    expect(ownerPackages([both])[0]).toMatchObject({
      description: "db", license: "PostgreSQL", homepage: "https://www.postgresql.org",
    });
  });
});

describe("indexFilenames", () => {
  it("lists stored images and the toml files, never external artifacts", () => {
    expect(indexFilenames([rec()], "postgres")).toEqual(["postgres-17.10.7-linux-x64.img", "postgres-17.10.7.toml"]);
  });
  it("lists only hosted images for a legacy record — no toml, nothing not actually stored", () => {
    expect(indexFilenames([rec({ manifest_toml: "", manifest: {} })], "postgres")).toEqual(["postgres-17.10.7-linux-x64.img"]);
  });
});
