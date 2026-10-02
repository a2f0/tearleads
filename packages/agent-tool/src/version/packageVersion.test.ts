import { describe, expect, test } from "bun:test";

import {
  bumpPatch,
  isReleaseBump,
  isVersionedManifest,
  readVersion,
  withVersion,
  workspacePackages,
} from "./packageVersion";
import { commitAll, repository, write } from "./version.testUtils";

const manifest = `{
  "name": "demo",
  "version": "0.7.101",
  "overrides": {
    "thing": { "version": "0.7.101" }
  }
}
`;

describe("packageVersion", () => {
  test("bumps only the patch", () => {
    expect(bumpPatch("0.7.101")).toBe("0.7.102");
    expect(bumpPatch("1.0.9")).toBe("1.0.10");
  });

  test("rejects versions that are not plain major.minor.patch", () => {
    expect(() => bumpPatch("1.0.0-beta.1")).toThrow("not a plain");
    expect(() => bumpPatch("01.0.0")).toThrow("not a plain");
  });

  test("treats a major or minor increase as a deliberate release", () => {
    expect(isReleaseBump("0.8.0", "0.7.101")).toBe(true);
    expect(isReleaseBump("1.0.0", "0.7.101")).toBe(true);
    expect(isReleaseBump("0.7.105", "0.7.101")).toBe(false);
    expect(isReleaseBump("0.7.101", "0.7.101")).toBe(false);
  });

  test("rewrites only the top-level version line", () => {
    const updated = withVersion(manifest, "0.7.102");
    expect(readVersion(updated)).toBe("0.7.102");
    expect(updated).toBe(
      manifest.replace('"version": "0.7.101"', '"version": "0.7.102"'),
    );
  });

  test("rejects non-release versions and escapes literal dots", () => {
    const build = `{"name": "demo", "version": "1.0.0+build"}`;
    expect(() => readVersion(build)).toThrow("not a plain");
    const lookalike = `{"x": {"version": "1x0x0"}, "version": "1.0.0"}`;
    expect(withVersion(lookalike, "1.0.1")).toBe(
      `{"x": {"version": "1x0x0"}, "version": "1.0.1"}`,
    );
  });

  test("refuses to rewrite a nested version that comes first", () => {
    const nestedFirst = `{"overrides": {"version": "1.0.0"}, "version": "1.0.0"}`;
    expect(() => withVersion(nestedFirst, "1.0.1")).toThrow(
      "could not rewrite",
    );
  });

  test("discovers private and newly registered workspaces without a package allowlist", () => {
    const root = repository();
    write(
      root,
      "packages/extra/package.json",
      '{"name":"extra","version":"1.0.0","private":true}',
    );
    write(
      root,
      "packages/windowing/fixtures/package.json",
      '{"name":"fixture","version":"1.0.0"}',
    );
    commitAll(root, "chore: add package");
    expect(workspacePackages(root)).toEqual([
      "packages/agent-tool",
      "packages/extra",
      "packages/windowing",
    ]);
    expect(isVersionedManifest(root, "packages/extra/package.json")).toBe(true);
    expect(
      isVersionedManifest(root, "packages/windowing/fixtures/package.json"),
    ).toBe(false);
    expect(isVersionedManifest(root, "package.json")).toBe(false);
  });
});
