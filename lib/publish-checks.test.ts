import { describe, expect, it } from "vitest";
import { validatePublishBody } from "./records";
import { manifestJson } from "./manifest";

const toml = '[package]\nname = "a"\nversion = "1.0.0"\nentrypoint = ["x"]\n';
const good = { name: "a", version: "1.0.0", manifest_toml: toml, manifest: manifestJson(toml),
  artifacts: [{ arch: "x64", src: "https://h/a-1.0.0-linux-x64.img", sha256: "a".repeat(64), bytes: 1, verified: false }] };

describe("validatePublishBody", () => {
  it("accepts a well-formed record and derives type", () => {
    const r = validatePublishBody(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rec.type).toBe("app");
  });
  it("rejects a manifest that does not match its toml", () => {
    const r = validatePublishBody({ ...good, manifest: { package: { name: "b", version: "1.0.0" } } });
    expect(r).toEqual({ ok: false, error: "manifest does not match manifest_toml" });
  });
  it("rejects a name/version that differs from the manifest", () => {
    expect(validatePublishBody({ ...good, version: "2.0.0" }).ok).toBe(false);
  });
  it("rejects malformed artifacts", () => {
    expect(validatePublishBody({ ...good, artifacts: [{ arch: "mips", src: "https://h/x", sha256: "zz", bytes: 1, verified: false }] }).ok).toBe(false);
    expect(validatePublishBody({ ...good, artifacts: [{ arch: "x64", src: "http://h/x.img", sha256: "a".repeat(64), bytes: 1, verified: false }] }).ok).toBe(false);
  });
  it("never trusts a client-supplied verified flag", () => {
    const r = validatePublishBody({ ...good, artifacts: [{ ...good.artifacts[0], verified: true }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rec.artifacts[0].verified).toBe(false);
  });
  it("rejects an https src the URL parser refuses", () => {
    for (const src of ["https://", "https:// h/x.img", "https://h:99999/x.img"]) {
      const r = validatePublishBody({ ...good, artifacts: [{ ...good.artifacts[0], src }] });
      expect(r, src).toEqual({ ok: false, error: "artifact src must be a valid https URL" });
    }
  });
  it("accepts a src whose filename holds a stray % — R2 keys are literal, never decoded", () => {
    // This used to be a landmine: `basename()` decoded, `decodeURIComponent`
    // threw on the lone `%`, and it threw AFTER the record was saved — so
    // every later publish in that namespace 500'd forever.
    const r = validatePublishBody({ ...good, artifacts: [{ ...good.artifacts[0], src: "https://h/a-100%-x64.img" }] });
    expect(r.ok).toBe(true);
  });
  it("rejects a package name that can't be an R2 key segment", () => {
    const badToml = '[package]\nname = "Bad_Name"\nversion = "1.0.0"\nentrypoint = ["x"]\n';
    const r = validatePublishBody({ name: "Bad_Name", version: "1.0.0", manifest_toml: badToml, manifest: manifestJson(badToml), artifacts: [] });
    expect(r).toEqual({ ok: false, error: "package names are lowercase [a-z0-9-], starting with a letter or digit" });
  });
});
