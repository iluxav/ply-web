// The cross-repo contract, pinned by a real artifact of the other side.
//
// `lib/fixtures/record-postgres.json` is the verbatim output of
//
//   cargo run -q -p ply-cli -- inspect services/postgres --json
//
// run in the ply repo (the same bytes `ply push` POSTs to /api/publish/,
// minus the artifacts the push adds). Two independent TOML parsers meet
// here — Rust's `toml` on the CLI side, smol-toml on the server's — and the
// publish only succeeds if they agree key for key, which `sameJson` inside
// `validatePublishBody` checks. That agreement is the whole "manifest is
// the record" premise, and nothing else in either test suite would notice
// it breaking.
//
// Regenerate the fixture with the command above whenever
// services/postgres/ply.toml changes.
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/record-postgres.json";
import { validatePublishBody } from "./records";
import { derive } from "./manifest";

describe("the CLI's record, as this registry reads it", () => {
  it("is accepted by validatePublishBody, identity and kind included", () => {
    const r = validatePublishBody(fixture);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.rec).toMatchObject({ owner: "ply", name: "postgres", version: "17.10.7", type: "app" });
    // the manifest_toml is the record's own text, not a re-rendering
    expect(r.rec.manifest_toml).toBe(fixture.manifest_toml);
  });

  it("derives the listing fields state.json publishes for postgres", () => {
    const d = derive(fixture.manifest);
    expect(d).toMatchObject({
      description: "PostgreSQL relational database (docker-library env contract)",
      license: "PostgreSQL",
      homepage: "https://www.postgresql.org",
      volumes: ["/var/lib/postgresql/data"],
      links: [],
      publish: "internal:5432",
      dependencies: { postgresql17: "17", rclone: "1.60" },
    });
    // params ride through verbatim — a secret stays valueless
    expect(d.params.password).toEqual({ secret: true });
    expect(d.params.url).toBe("postgres://{user}:{password}@{host}:{port}/{database}");
  });
});
