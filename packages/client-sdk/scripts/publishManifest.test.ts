import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishManifest, type Workspace } from "./publishManifest";

const fixtures: string[] = [];

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(range: string, catalog = {}, catalogs = {}) {
  const root = mkdtempSync(join(tmpdir(), "publish-manifest-"));
  fixtures.push(root);
  const directory = join(root, "packages", "client-sdk");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ catalog, catalogs }),
  );
  return new Map<string, Workspace>([
    [
      "@tearleads/client-sdk",
      {
        directory,
        manifest: {
          name: "@tearleads/client-sdk",
          version: "0.1.0",
          exports: {},
          dependencies: { "loro-crdt": range, zod: "4.6.7" },
        },
      },
    ],
  ]);
}

const imports = [{ source: 'import "loro-crdt";\nimport "zod";' }];

test.each([
  ["catalog:", { "loro-crdt": "1.16.4" }, {}, "1.16.4"],
  ["catalog:held", {}, { held: { "loro-crdt": "1.2.3" } }, "1.2.3"],
  ["2.3.4", {}, {}, "2.3.4"],
])(
  "preserves the declared Loro hold from %s",
  (range, catalog, catalogs, version) => {
    const manifest = publishManifest(
      fixture(range, catalog, catalogs),
      imports,
    );
    expect(manifest.dependencies).toEqual({
      "loro-crdt": version,
      zod: "^4.6.7",
    });
  },
);

test("rejects a missing held catalog value", () => {
  expect(() => publishManifest(fixture("catalog:held"), imports)).toThrow(
    "loro-crdt is missing from the catalog:held catalog",
  );
});

test("requires an exact declared version even for a held dependency", () => {
  expect(() => publishManifest(fixture("^1.16.4"), imports)).toThrow(
    "loro-crdt needs an exact workspace version, not ^1.16.4",
  );
});

test("rejects conflicting versions across bundled workspaces", () => {
  const workspaces = fixture("1.16.4");
  workspaces.set("@tearleads/loro", {
    directory: "unused",
    manifest: {
      name: "@tearleads/loro",
      version: "0.1.0",
      exports: {},
      dependencies: { "loro-crdt": "1.17.1" },
    },
  });
  expect(() => publishManifest(workspaces, imports)).toThrow(
    "bundled workspaces disagree on loro-crdt",
  );
});
