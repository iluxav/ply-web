import { describe, expect, it } from "vitest";
import { depsOf, paramRows } from "./registry";

describe("paramRows", () => {
  it("classifies every declaration kind and never carries a secret value", () => {
    expect(paramRows({ user: "postgres", url: "x://{host}", password: { secret: true }, key: { secret: true, external: true } })).toEqual([
      { name: "key", kind: "secret (external)" },
      { name: "password", kind: "secret (minted)" },
      { name: "url", kind: "computed", value: "x://{host}" },
      { name: "user", kind: "default", value: "postgres" },
    ]);
    expect(paramRows(undefined)).toEqual([]);
  });
});
describe("depsOf", () => {
  it("reads v2 arrays and v3 objects alike", () => {
    expect(depsOf({ version: "1", img: null, bytes: 0, pushed_at: "", dependencies: [{ name: "a", version: "1.0.0" }] })).toEqual([{ name: "a", version: "1.0.0" }]);
    expect(depsOf({ version: "1", img: null, bytes: 0, pushed_at: "", dependencies: { a: "1" } })).toEqual([{ name: "a", version: "1" }]);
  });
});
