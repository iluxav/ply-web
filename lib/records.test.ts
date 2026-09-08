import { describe, expect, it } from "vitest";
import { firstDiff, mergePublish } from "./records";
import type { Artifact } from "./manifest";

const x64: Artifact = { arch: "x64", src: "https://registry.plybox.sh/ply/a/a-1.0.0-linux-x64.img", sha256: "aa", bytes: 1, verified: true };
const arm: Artifact = { arch: "arm64", src: "https://registry.plybox.sh/ply/a/a-1.0.0-linux-arm64.img", sha256: "bb", bytes: 1, verified: true };

describe("mergePublish", () => {
  it("creates a version on first publish", () => {
    expect(mergePublish(null, { manifest_toml: "m", artifacts: [x64] })).toEqual({ status: 201, artifacts: [x64] });
  });
  it("appends a new arch whose manifest differs only in architecture spellings", () => {
    // deb2pkg kegs: the same package, one manifest per machine.
    const armToml = "[package]\nname = \"python3\"\nprovides_abi = \"linux-arm64-gnu\"\n[layer]\nld_library_path = [\"/opt/python3-3.13.5/usr/lib/aarch64-linux-gnu\"]\n";
    // …and the converter's sorted path lists land in a different order per
    // architecture, which is not a different manifest either.
    const x64Toml = "[package]\nname = \"python3\"\nprovides_abi = \"linux-x64-gnu\"\n[layer]\nld_library_path = [\n    \"/opt/python3-3.13.5/usr/lib/python3.13/lib-dynload\",\n    \"/opt/python3-3.13.5/usr/lib/x86_64-linux-gnu\",\n]\n";
    const armToml2 = "[package]\nname = \"python3\"\nprovides_abi = \"linux-arm64-gnu\"\n[layer]\nld_library_path = [\n    \"/opt/python3-3.13.5/usr/lib/aarch64-linux-gnu\",\n    \"/opt/python3-3.13.5/usr/lib/python3.13/lib-dynload\",\n]\n";
    expect(mergePublish({ manifest_toml: armToml2, artifacts: [arm] }, { manifest_toml: x64Toml, artifacts: [x64] }).status).toBe(201);
    const r = mergePublish({ manifest_toml: armToml, artifacts: [arm] }, { manifest_toml: x64Toml.replace("lib-dynload\",\n    ", "lib-dynload\",\n    ").replace(/\[\n    "[^"]*lib-dynload",\n    /, "[\n    "), artifacts: [x64] });
    expect(r.status).toBe(201);
    // …but a manifest that differs in anything else is still another version.
    const other = x64Toml.replace("python3-3.13.5", "python3-3.13.6");
    expect(mergePublish({ manifest_toml: armToml, artifacts: [arm] }, { manifest_toml: other, artifacts: [x64] }).status).toBe(409);
  });
  it("appends a new arch to an existing version with the same manifest", () => {
    const r = mergePublish({ manifest_toml: "m", artifacts: [x64] }, { manifest_toml: "m", artifacts: [arm] });
    expect(r).toEqual({ status: 201, artifacts: [x64, arm] });
  });
  it("is idempotent for an identical artifact", () => {
    const r = mergePublish({ manifest_toml: "m", artifacts: [x64] }, { manifest_toml: "m", artifacts: [x64] });
    expect(r).toEqual({ status: 200, artifacts: [x64] });
  });
  it("refuses to replace an artifact with different bytes", () => {
    const r = mergePublish({ manifest_toml: "m", artifacts: [x64] }, { manifest_toml: "m", artifacts: [{ ...x64, sha256: "cc" }] });
    expect(r.status).toBe(409);
    expect((r as { error: string }).error).toMatch(/x64.*already published/);
  });
  it("refuses a different manifest for the same version, naming the first differing line", () => {
    const r = mergePublish({ manifest_toml: "a = 1\nb = 2\n", artifacts: [x64] }, { manifest_toml: "a = 1\nb = 3\n", artifacts: [arm] });
    expect(r.status).toBe(409);
    expect((r as { diff?: string }).diff).toBe("line 2: b = 2 | b = 3");
  });
  it("rejects a record with no artifacts unless it is a stack (empty allowed only on first publish)", () => {
    expect(mergePublish(null, { manifest_toml: "m", artifacts: [] })).toEqual({ status: 201, artifacts: [] });
    expect(mergePublish({ manifest_toml: "m", artifacts: [] }, { manifest_toml: "m", artifacts: [] })).toEqual({ status: 200, artifacts: [] });
  });
  it("rejects two artifacts for one arch in a single publish", () => {
    const r = mergePublish(null, { manifest_toml: "m", artifacts: [x64, { ...x64, sha256: "cc" }] });
    expect(r.status).toBe(400);
  });
});

describe("mergePublish — legacy manifest-less records (F4 backfill)", () => {
  it("accepts any manifest for an existing manifest-less record: 201 when it adds an arch", () => {
    const r = mergePublish({ manifest_toml: "", artifacts: [x64] }, { manifest_toml: "m", artifacts: [arm] });
    expect(r).toEqual({ status: 201, artifacts: [x64, arm] });
  });
  it("accepts any manifest for an existing manifest-less record: 200 when the artifact is unchanged", () => {
    const r = mergePublish({ manifest_toml: "", artifacts: [x64] }, { manifest_toml: "m", artifacts: [x64] });
    expect(r).toEqual({ status: 200, artifacts: [x64] });
  });
  it("still 409s on a genuine manifest mismatch when the existing manifest is non-empty", () => {
    const r = mergePublish({ manifest_toml: "a = 1\n", artifacts: [x64] }, { manifest_toml: "a = 2\n", artifacts: [arm] });
    expect(r.status).toBe(409);
  });
});

describe("firstDiff", () => {
  it("names the first differing line", () => {
    expect(firstDiff("a\nb", "a\nc")).toBe("line 2: b | c");
    expect(firstDiff("a", "a\nb")).toBe("line 2: <end> | b");
  });
});
