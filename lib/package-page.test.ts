import { describe, expect, it } from "vitest";
import { manifestJson } from "./manifest";
import type { RegistryPackage, RegistryVersion } from "./registry";
import {
  memberSnippet,
  referenceLines,
  runExample,
  secretEnvFlags,
  stackMembers,
} from "./package-page";
import { parseManifest } from "./manifest-source";

const POSTGRES_TOML = `
[package]
name = "postgres"
owner = "ply"
version = "17.10.7"
description = "PostgreSQL relational database"
entrypoint = ["./run.sh"]
base = "debian@13"

[params]
user = "postgres"
database = "postgres"
password = { secret = true }
url = "postgres://{user}:{password}@{host}:{port}/{database}"

[env]
POSTGRES_USER = "{user}"
POSTGRES_DB = "{database}"
POSTGRES_PASSWORD = "{password}"
`;

const STACK_TOML = `
[stack]
name = "todos"
owner = "iluxav"
version = "0.1.0"

[[app]]
run = "postgres@17"
name = "db"
params = { database = "todos" }

[[app]]
run = "iluxav/todos-server@0.1"
e = ["DATABASE_URL={db.url}"]
`;

const LAYER_TOML = `
[package]
name = "debian"
owner = "ply"
version = "13.0.0"
`;

// A URL run and a path run, to exercise classify_run's dash-cutting default
// name (registry refs never cut at "-"; see STACK_TOML's todos-server).
const REF_KINDS_STACK_TOML = `
[stack]
name = "kinds"
version = "0.1.0"

[[app]]
run = "https://h/postgres-17.10.7-x64.img"

[[app]]
run = "./server"
`;

const QUOTED_APP_TOML = `
[package]
name = "quoter"
owner = "ply"
version = "1.0.0"
entrypoint = ["./run.sh"]
`;

const postgresPkg: RegistryPackage = {
  namespace: "ply",
  type: "app",
  name: "postgres",
  description: "PostgreSQL relational database",
  license: "PostgreSQL",
  homepage: "",
  versions: [],
};

const postgresLatest: RegistryVersion = {
  version: "17",
  img: "postgres-17-x64.img",
  bytes: 0,
  pushed_at: "",
  params: {
    user: "postgres",
    database: "postgres",
    password: { secret: true },
    url: "postgres://{user}:{password}@{host}:{port}/{database}",
  },
};

const todosPkg: RegistryPackage = {
  namespace: "iluxav",
  type: "stack",
  name: "todos",
  description: "",
  license: "",
  homepage: "",
  versions: [],
};

const todosLatest: RegistryVersion = {
  version: "0.1.0",
  img: null,
  bytes: 0,
  pushed_at: "",
};

const debianPkg: RegistryPackage = {
  namespace: "ply",
  type: "layer",
  name: "debian",
  description: "",
  license: "",
  homepage: "",
  versions: [],
};

const debianLatest: RegistryVersion = {
  version: "13.0.0",
  img: "debian-13-x64.img",
  bytes: 0,
  pushed_at: "",
};

// A "v3 bridge" record: state.json already says type "app" (and may already
// carry params), but the manifest hasn't been backfilled yet — manifest is
// null. Must render exactly as a legacy entry, i.e. no new blocks.
const bridgePkg: RegistryPackage = {
  namespace: "ply",
  type: "app",
  name: "bridged",
  description: "",
  license: "",
  homepage: "",
  versions: [],
};

const bridgeLatest: RegistryVersion = {
  version: "1.0.0",
  img: "bridged-1-x64.img",
  bytes: 0,
  pushed_at: "",
  params: { size: "small" },
};

describe("secretEnvFlags", () => {
  it("emits -e for env values that are exactly one secret param hole, sorted by key", () => {
    const m = manifestJson(POSTGRES_TOML);
    expect(secretEnvFlags(m)).toEqual(["-e POSTGRES_PASSWORD=…"]);
  });
  it("is empty for a manifest with no env table (e.g. a stack)", () => {
    expect(secretEnvFlags(manifestJson(STACK_TOML))).toEqual([]);
  });
});

describe("runExample", () => {
  it("builds a ply run line with major.minor pin and secret env flags", () => {
    const m = manifestJson(POSTGRES_TOML);
    expect(runExample(postgresPkg, postgresLatest, m)).toBe(
      "ply run postgres@17 -e POSTGRES_PASSWORD=…",
    );
  });
  it("builds a ply up line for a stack, namespaced when not ply/", () => {
    const m = manifestJson(STACK_TOML);
    expect(runExample(todosPkg, todosLatest, m)).toBe("ply up iluxav/todos@0.1");
  });
  it("is empty for a layer (no entrypoint)", () => {
    const m = manifestJson(LAYER_TOML);
    expect(runExample(debianPkg, debianLatest, m)).toBe("");
  });
  it("is empty when the manifest could not be fetched", () => {
    expect(runExample(postgresPkg, postgresLatest, null)).toBe("");
  });
});

describe("memberSnippet", () => {
  it("builds a [[app]] block with the first default param and an overridable comment", () => {
    const m = manifestJson(POSTGRES_TOML);
    const snippet = memberSnippet(postgresPkg, postgresLatest, m);
    expect(snippet).toContain("[[app]]");
    expect(snippet).toContain('params = { database = "postgres" }');
    expect(snippet).toContain("# overridable: database, user");
  });
  it("is empty for a stack", () => {
    expect(memberSnippet(todosPkg, todosLatest, manifestJson(STACK_TOML))).toBe("");
  });
  it("is empty for a layer", () => {
    expect(memberSnippet(debianPkg, debianLatest, manifestJson(LAYER_TOML))).toBe("");
  });
  it("is empty for an app entry whose manifest hasn't been backfilled (manifest: null)", () => {
    expect(memberSnippet(bridgePkg, bridgeLatest, null)).toBe("");
  });
  it("escapes a quote and a trailing backslash in the interpolated default value", () => {
    const quote = '"';
    const backslash = "\\";
    const rawValue = `say ${quote}hi${quote}${backslash}`;
    const escapedValue = `say ${backslash}${quote}hi${backslash}${quote}${backslash}${backslash}`;
    const quotedLatest: RegistryVersion = {
      version: "1.0.0",
      img: "quoter-1-x64.img",
      bytes: 0,
      pushed_at: "",
      params: { greeting: rawValue },
    };
    const quotedPkg: RegistryPackage = { ...postgresPkg, name: "quoter" };
    const snippet = memberSnippet(quotedPkg, quotedLatest, manifestJson(QUOTED_APP_TOML));
    expect(snippet).toContain(`params = { greeting = ${quote}${escapedValue}${quote} }`);
  });
});

describe("referenceLines", () => {
  it("lists every param plus the built-in facts, namespaced under the member name", () => {
    const m = manifestJson(POSTGRES_TOML);
    const refs = referenceLines(postgresPkg, postgresLatest, m);
    expect(refs).toContain("{postgres.url}");
    expect(refs).toContain("{postgres.base_url}");
  });
  it("is empty for a stack", () => {
    expect(referenceLines(todosPkg, todosLatest, manifestJson(STACK_TOML))).toEqual([]);
  });
  it("is empty for an app entry whose manifest hasn't been backfilled (manifest: null)", () => {
    expect(referenceLines(bridgePkg, bridgeLatest, null)).toEqual([]);
  });
});

describe("stackMembers", () => {
  it("reads [[app]] tables, defaulting name to the run ref's basename, and collects {x.y} refs from e", () => {
    const m = manifestJson(STACK_TOML);
    const members = stackMembers(m);
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({
      run: "postgres@17",
      name: "db",
      params: { database: "todos" },
      refs: [],
    });
    expect(members[1]).toMatchObject({
      run: "iluxav/todos-server@0.1",
      name: "todos-server",
      refs: ["{db.url}"],
    });
  });
  it("is empty when not a stack", () => {
    expect(stackMembers(manifestJson(POSTGRES_TOML))).toEqual([]);
  });
  it("is empty for a null manifest", () => {
    expect(stackMembers(null)).toEqual([]);
  });
  it("mirrors classify_run's default name for a URL run: last segment, cut at the first '-'", () => {
    const members = stackMembers(manifestJson(REF_KINDS_STACK_TOML));
    expect(members[0].name).toBe("postgres");
  });
  it("mirrors classify_run's default name for a path run: last segment (no '-' to cut)", () => {
    const members = stackMembers(manifestJson(REF_KINDS_STACK_TOML));
    expect(members[1].name).toBe("server");
  });
  it("keeps a registry ref's default name as the full basename — no '-' cut", () => {
    // "iluxav/todos-server@0.1" must stay "todos-server", not cut to "todos".
    const members = stackMembers(manifestJson(STACK_TOML));
    expect(members[1].name).toBe("todos-server");
  });
});

describe("parseManifest", () => {
  it("parses valid toml", () => {
    expect(parseManifest('[package]\nname = "x"')).toEqual({ package: { name: "x" } });
  });
  it("returns null on invalid toml", () => {
    expect(parseManifest("[")).toBeNull();
  });
});
