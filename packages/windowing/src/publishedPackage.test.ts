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
  expect(manifest.exports["."]).toEqual({
    default: "./index.js",
    types: "./index.d.ts",
  });
  expect(manifest.peerDependencies).toEqual({
    react: "^19.0.0",
    "react-dom": "^19.0.0",
  });
  for (const range of Object.values<string>(manifest.dependencies)) {
    expect(range).not.toMatch(/^(workspace|catalog):/);
  }
  expect(Object.keys(manifest.dependencies)).toEqual(["@phosphor-icons/react"]);
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

test("the build ships types and stylesheets, and no tests", () => {
  expect(files).toContain("index.d.ts");
  expect(files).toContain("tokens.css");
  expect(files).toContain("README.md");
  expect(files.filter((file) => /test/i.test(file))).toEqual([]);
});
