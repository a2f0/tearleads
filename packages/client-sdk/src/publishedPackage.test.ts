import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildPackage } from "../scripts/buildPackage";
import {
  listFiles,
  moduleSpecifiers,
  packageName,
} from "../scripts/packageOutput";

// The package npm receives is built once into a temporary directory, so these
// checks never depend on (or disturb) the workspace's dist/.
const outDir = mkdtempSync(join(tmpdir(), "client-sdk-package-"));
let files: string[] = [];
let manifest: {
  dependencies: Record<string, string>;
  exports: Record<string, string | { default: string; types: string }>;
  private?: boolean;
  repository: unknown;
};

beforeAll(async () => {
  await buildPackage(outDir);
  files = await listFiles(outDir);
  manifest = JSON.parse(readOutput("package.json"));
}, 120_000);

afterAll(() => {
  rmSync(outDir, { force: true, recursive: true });
});

function readOutput(file: string) {
  return readFileSync(join(outDir, file), "utf8");
}

test("the published manifest is consumable outside the workspace", () => {
  expect(manifest.private).toBeUndefined();
  expect(manifest.repository).toEqual({
    type: "git",
    url: "git+https://github.com/a2f0/tearleads.git",
    directory: "packages/client-sdk",
  });
  expect(manifest.exports).toEqual({
    ".": { types: "./index.d.ts", default: "./index.js" },
    "./sqlite": { types: "./sqlite.d.ts", default: "./sqlite.js" },
    "./sqlite/worker.js": "./sqlite/worker.js",
    "./sqlite/sqlite3.wasm": "./sqlite/sqlite3.wasm",
    "./sqlite/sqlite3-licenses.md": "./sqlite/sqlite3-licenses.md",
    "./testing": {
      types: "./data/trustedUserIdentity/testFixtures.d.ts",
      default: "./data/trustedUserIdentity/testFixtures.js",
    },
  });
  for (const range of Object.values(manifest.dependencies)) {
    expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
  }
  expect(Object.keys(manifest.dependencies)).toEqual([
    "@noble/hashes",
    "@noble/post-quantum",
    "@scure/bip39",
    "drizzle-orm",
    "loro-crdt",
    "zod",
  ]);
});

test("every export target ships", () => {
  for (const target of Object.values(manifest.exports)) {
    const paths =
      typeof target === "string" ? [target] : [target.default, target.types];
    for (const path of paths) {
      expect(files).toContain(path.slice(2));
    }
  }
});

// A host serves these files as they are, so the worker must load nothing but
// the SQLite WebAssembly beside it.
test("the SQLite worker ships as one self-contained module", () => {
  const worker = readOutput("sqlite/worker.js");
  expect(moduleSpecifiers(worker)).toEqual([]);
  expect(worker).toMatch(
    /new URL\(\s*["']sqlite3\.wasm["']\s*,\s*import\.meta\.url\s*\)/,
  );
  expect(readOutput("sqlite/sqlite3-licenses.md")).toContain(
    "SQLite3 Multiple Ciphers",
  );
});

// Workspace packages ship compiled under internal/, so a module reaches only
// its own files and the npm dependencies the manifest declares.
test("every module and declaration imports only its own files or a dependency", () => {
  const sources = files.filter(
    (file) => file.endsWith(".js") || file.endsWith(".d.ts"),
  );
  expect(sources).toContain("internal/crypto/index.js");

  for (const file of sources) {
    for (const specifier of moduleSpecifiers(readOutput(file))) {
      if (specifier.startsWith(".")) {
        expect({ file, specifier }).toEqual({
          file,
          specifier: expect.stringMatching(/\.js$/),
        });
        const target = join(dirname(file), specifier);
        const resolved = file.endsWith(".d.ts")
          ? target.replace(/\.js$/, ".d.ts")
          : target;
        expect({
          file,
          resolved,
          exists: existsSync(join(outDir, resolved)),
        }).toEqual({ file, resolved, exists: true });
      } else {
        expect(Object.keys(manifest.dependencies)).toContain(
          packageName(specifier),
        );
      }
    }
  }
});

// The manifest declares the package free of side effects, so a bundler drops
// any module imported only for its side effects.
test("no module is imported only for its side effects", () => {
  const sideEffectImports = files
    .filter((file) => file.endsWith(".js"))
    .filter((file) => /^import\s*["']/m.test(readOutput(file)));
  expect(sideEffectImports).toEqual([]);
});

test("source maps name their sources without build paths", () => {
  const maps = files.filter((file) => file.endsWith(".js.map"));
  expect(maps).toContain("index.js.map");

  for (const file of maps) {
    const { sources }: { sources: string[] } = JSON.parse(readOutput(file));
    for (const source of sources) {
      expect({ file, source }).toEqual({
        file,
        source: expect.stringMatching(/^[^/\\]+\.ts$/),
      });
    }
  }
});

test("the build ships the README and no tests besides the ./testing entry", () => {
  expect(files).toContain("README.md");
  expect(
    files.filter((file) =>
      /\.(test|testFixtures|testUtils)\.(js|d\.ts)(\.map)?$/.test(file),
    ),
  ).toEqual([]);
  expect(files).toContain("data/trustedUserIdentity/testFixtures.js");
});
