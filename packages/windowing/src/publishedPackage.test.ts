import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildPackage } from "../scripts/buildPackage";

// The package npm receives is built once into a temporary directory, so these
// checks never depend on (or leave behind) a stale dist/.
const outDir = mkdtempSync(join(tmpdir(), "windowing-package-"));
let files: string[] = [];

beforeAll(async () => {
  await buildPackage(outDir);
  files = (await readdir(outDir, { recursive: true })).map(String);
}, 120_000);

afterAll(() => {
  rmSync(outDir, { force: true, recursive: true });
});

function readOutput(file: string) {
  return readFileSync(join(outDir, file), "utf8");
}

function moduleSpecifiers(source: string) {
  return [...source.matchAll(/\b(?:from|import)\s+["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

test("the published manifest is consumable outside the workspace", () => {
  const manifest = JSON.parse(readOutput("package.json"));

  expect(manifest.private).toBeUndefined();
  expect(manifest.repository).toEqual({
    type: "git",
    url: "git+https://github.com/a2f0/tearleads.git",
    directory: "packages/windowing",
  });
  expect(manifest.exports["."]).toEqual({
    default: "./index.js",
    types: "./index.d.ts",
  });
  expect(manifest.peerDependencies).toEqual({
    react: "^19.2.0",
    "react-dom": "^19.2.0",
  });
  for (const range of Object.values<string>(manifest.dependencies)) {
    expect(range).not.toMatch(/^(workspace|catalog):/);
  }
  expect(Object.keys(manifest.dependencies)).toEqual(["@phosphor-icons/react"]);
});

// A module made only of imports and re-exports: a bundler that trusts
// sideEffects routes imports past it, dropping its own imports with it.
function isBarrel(source: string) {
  const statements = source
    .replace(/\/\/.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  return statements.every((statement) =>
    /^(import\s+["']|export\s+\{[^}]*\}\s+from\s)/.test(statement),
  );
}

test("a barrel that imports a stylesheet is declared a side effect", () => {
  const { sideEffects } = JSON.parse(readOutput("package.json"));
  const barrels = files.filter((file) => {
    if (!file.endsWith(".js")) {
      return false;
    }
    const source = readOutput(file);
    return /^import\s+["'][^"']+\.css["'];/m.test(source) && isBarrel(source);
  });

  expect(barrels).toContain("index.js");
  for (const file of barrels) {
    expect(sideEffects).toContain(`./${file}`);
  }
});

test("every module imports only React, Phosphor, or its own files", () => {
  const modules = files.filter((file) => file.endsWith(".js"));
  expect(modules).toContain("index.js");

  for (const file of modules) {
    for (const specifier of moduleSpecifiers(readOutput(file))) {
      if (specifier.startsWith(".")) {
        expect(specifier).toMatch(/\.(js|css)$/);
        expect(existsSync(join(outDir, dirname(file), specifier))).toBe(true);
      } else {
        expect(specifier).toMatch(
          /^(react|react-dom|@phosphor-icons\/react)(\/|$)/,
        );
      }
    }
  }
});

test("declarations import no stylesheets", () => {
  const declarations = files.filter((file) => file.endsWith(".d.ts"));
  expect(declarations).toContain("index.d.ts");

  for (const file of declarations) {
    const stylesheets = moduleSpecifiers(readOutput(file)).filter((specifier) =>
      specifier.endsWith(".css"),
    );
    expect({ file, stylesheets }).toEqual({ file, stylesheets: [] });
  }
});

test("the build ships types and stylesheets, and no tests", () => {
  expect(files).toContain("index.d.ts");
  expect(files).toContain("tokens.css");
  expect(files).toContain("README.md");
  expect(files.filter((file) => /test/i.test(file))).toEqual([]);
});
