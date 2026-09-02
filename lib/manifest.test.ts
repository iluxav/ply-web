import { describe, expect, it } from "vitest";
import { derive, identityOf, kindOf, manifestJson, sameJson } from "./manifest";

const POSTGRES = `
[package]
name = "postgres"
owner = "ply"
version = "17.10.7"
description = "PostgreSQL relational database"
license = "PostgreSQL"
homepage = "https://www.postgresql.org"
entrypoint = ["./run.sh"]
base = "debian@13"

[dependencies]
postgresql17 = "17"
rclone = "1.60"

[volumes]
data = { path = "/var/lib/postgresql/data" }

[ports]
db = 5432

[params]
user = "postgres"
password = { secret = true }
url = "postgres://{user}:{password}@{host}:{port}/{database}"

[env]
POSTGRES_USER = "{user}"

[requests]
links = ["/var/run/docker.sock:/var/run/docker.sock"]
`;

const STACK = `
[stack]
name = "todos"
version = "0.1.0"

[[app]]
run = "postgres@17"
name = "db"
params = { database = "todos" }

[[app]]
run = "iluxav/todos-server@0.1"
e = ["DATABASE_URL={db.url}"]
`;

describe("manifestJson", () => {
  it("renders the toml key for key", () => {
    const m = manifestJson(POSTGRES);
    expect((m.package as { name: string }).name).toBe("postgres");
    expect((m.params as { password: { secret: boolean } }).password.secret).toBe(true);
    expect((m.env as { POSTGRES_USER: string }).POSTGRES_USER).toBe("{user}");
  });
  it("throws on invalid toml", () => {
    expect(() => manifestJson("[package\nname = 1")).toThrow();
  });
});

describe("kindOf and identityOf", () => {
  it("classifies app, layer and stack", () => {
    expect(kindOf(manifestJson(POSTGRES))).toBe("app");
    expect(kindOf(manifestJson('[package]\nname = "x"\nversion = "1.0.0"'))).toBe("layer");
    expect(kindOf(manifestJson(STACK))).toBe("stack");
  });
  it("reads identity from [package] or [stack]", () => {
    expect(identityOf(manifestJson(POSTGRES))).toEqual({ owner: "ply", name: "postgres", version: "17.10.7" });
    expect(identityOf(manifestJson(STACK))).toEqual({ owner: undefined, name: "todos", version: "0.1.0" });
    expect(() => identityOf(manifestJson('[package]\nname = "x"'))).toThrow(/version/);
  });
});

describe("derive", () => {
  it("computes every listing field from the manifest", () => {
    const d = derive(manifestJson(POSTGRES));
    expect(d.description).toBe("PostgreSQL relational database");
    expect(d.license).toBe("PostgreSQL");
    expect(d.homepage).toBe("https://www.postgresql.org");
    expect(d.volumes).toEqual(["/var/lib/postgresql/data"]);
    expect(d.links).toEqual(["/var/run/docker.sock:/var/run/docker.sock"]);
    expect(d.publish).toBe("internal:5432");
    expect(d.dependencies).toEqual({ postgresql17: "17", rclone: "1.60" });
    expect(d.params).toEqual({
      user: "postgres",
      password: { secret: true },
      url: "postgres://{user}:{password}@{host}:{port}/{database}",
    });
  });
  it("omits publish when ports has zero or several entries", () => {
    expect(derive(manifestJson('[package]\nname="a"\nversion="1.0.0"')).publish).toBeUndefined();
    expect(derive(manifestJson('[package]\nname="a"\nversion="1.0.0"\n[ports]\na=1\nb=2')).publish).toBeUndefined();
  });
  it("is empty-safe for a stack", () => {
    const d = derive(manifestJson(STACK));
    expect(d.volumes).toEqual([]);
    expect(d.params).toEqual({});
  });
});

describe("sameJson", () => {
  it("ignores key order and nothing else", () => {
    expect(sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: "1" })).toBe(false);
  });
  it("distinguishes dates", () => {
    expect(sameJson({ d: new Date("2024-01-01T00:00:00Z") }, { d: new Date("2025-01-01T00:00:00Z") })).toBe(false);
    expect(sameJson({ d: new Date("2024-01-01T00:00:00Z") }, { d: new Date("2024-01-01T00:00:00Z") })).toBe(true);
  });
});
