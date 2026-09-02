import { describe, expect, it } from "vitest";
import { firstDiff, mergePublish } from "./records";
import type { Artifact } from "./manifest";

const x64: Artifact = { arch: "x64", src: "https://registry.plybox.sh/ply/a/a-1.0.0-linux-x64.img", sha256: "aa", bytes: 1, verified: true };
const arm: Artifact = { arch: "arm64", src: "https://registry.plybox.sh/ply/a/a-1.0.0-linux-arm64.img", sha256: "bb", bytes: 1, verified: true };

describe("mergePublish", () => {
  it("creates a version on first publish", () => {
    expect(mergePublish(null, { manifest_toml: "m", artifacts: [x64] })).toEqual({ status: 201, artifacts: [x64] });
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
