import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const distPath = join(packageRoot, "dist");

// The one deliberately shipped fixture module: it backs the package's
// "./testing" subpath export.
const publicTestingEntry = "data/trustedUserIdentity/testFixtures";

async function listDistFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(dirPath, entry.name);
      return entry.isDirectory()
        ? listDistFiles(entryPath)
        : [relative(distPath, entryPath)];
    }),
  );
  return nested.flat();
}

test("dist ships no test modules besides the ./testing entry", async () => {
  const files = await listDistFiles(distPath);

  const testArtifacts = files.filter((file) =>
    /\.(test|testFixtures|testUtils)\.(js|d\.ts)(\.map)?$/.test(file),
  );
  expect(testArtifacts).toEqual([]);

  // The intentional ./testing subpath target must keep being emitted.
  expect(files).toContain(`${publicTestingEntry}.js`);
  expect(files).toContain(`${publicTestingEntry}.d.ts`);
});

test("dist relative import specifiers all carry a .js extension", async () => {
  const files = await listDistFiles(distPath);
  const offenders: string[] = [];

  for (const file of files) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) {
      continue;
    }
    const content = readFileSync(join(distPath, file), "utf8");
    for (const match of content.matchAll(
      /\b(?:from|import)\s+(["'])(\.[^"']+)\1/g,
    )) {
      const specifier = match[2] ?? "";
      if (!specifier.endsWith(".js")) {
        offenders.push(`${file}: ${specifier}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

test("rewriteDistImports resolves dotted extensionless specifiers", () => {
  // extname("./service.testFixtures") is ".testFixtures", so an
  // extension-based skip would leave this specifier unresolvable in ESM.
  const fixtureDir = mkdtempSync(join(tmpdir(), "rewrite-dist-imports-"));
  try {
    writeFileSync(join(fixtureDir, "service.testFixtures.js"), "export {};\n");
    writeFileSync(join(fixtureDir, "plain.js"), "export {};\n");
    writeFileSync(
      join(fixtureDir, "index.js"),
      'import "./service.testFixtures";\nimport "./plain";\nimport "./already.js";\n',
    );

    const result = spawnSync(
      "bun",
      [join(packageRoot, "scripts", "rewriteDistImports.ts"), fixtureDir],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);

    expect(readFileSync(join(fixtureDir, "index.js"), "utf8")).toBe(
      'import "./service.testFixtures.js";\nimport "./plain.js";\nimport "./already.js";\n',
    );
  } finally {
    rmSync(fixtureDir, { force: true, recursive: true });
  }
});
