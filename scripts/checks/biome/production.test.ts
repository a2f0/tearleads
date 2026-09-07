import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const biomeBin = join(repoRoot, "node_modules/.bin/biome");

test("production promise checks resolve SDK calls through ignored build output", async () => {
  const fixtures: string[] = [];
  try {
    // Use the real package roots so imports and gitignored SDK declarations
    // resolve exactly as they do in the production scan. Always remove inputs.
    for (const packageName of ["api", "app", "client-sdk", "crypto"]) {
      const fixture = await mkdtemp(
        join(repoRoot, "packages", packageName, "src", "biomePromiseFixture"),
      );
      fixtures.push(fixture);
      const prefix =
        packageName === "app"
          ? 'import type { Tearleads } from "@tearleads/client-sdk";\n'
          : "async function task(): Promise<void> { await Promise.resolve(); }\n";
      const parameters = packageName === "app" ? "client: Tearleads" : "";
      const call =
        packageName === "app"
          ? "client.session.bootstrapLocalRootContainer()"
          : "task()";
      const unhandled = `${prefix}export function probe(${parameters}): void { ${call}; }`;
      const handled = `${prefix}export async function probe(${parameters}): Promise<void> { await ${call}; void ${call}; ${call}.catch(() => {}); }`;
      for (const [name, source] of Object.entries({
        "unhandled.ts": unhandled,
        "handled.ts": handled,
        "unhandled.test.ts": unhandled,
        "unhandled.testFixtures.ts": unhandled,
        "testUtils.ts": unhandled,
        "runtimeTestFixtures.tsx": unhandled,
      })) {
        await Bun.write(join(fixture, name), source);
      }
    }
    const result = Bun.spawnSync(
      [
        process.execPath,
        biomeBin,
        "lint",
        "--config-path",
        "biome.promises.jsonc",
        "--only=lint/nursery/noFloatingPromises",
        "--error-on-warnings",
        "--reporter=json",
        "--max-diagnostics=none",
        ...fixtures.map((fixture) => relative(repoRoot, fixture)),
      ],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(1);
    const report = JSON.parse(result.stdout.toString()) as {
      diagnostics: { category: string; location: { path: string } }[];
      summary: { errors: number; warnings: number };
    };
    expect(report.summary.errors, JSON.stringify(report.diagnostics)).toBe(4);
    expect(report.summary.warnings).toBe(0);
    expect(report.diagnostics.map((diagnostic) => diagnostic.category)).toEqual(
      Array(4).fill("lint/nursery/noFloatingPromises"),
    );
    expect(
      report.diagnostics.map((diagnostic) => diagnostic.location.path).sort(),
    ).toEqual(
      fixtures
        .map((fixture) => relative(repoRoot, join(fixture, "unhandled.ts")))
        .sort(),
    );
  } finally {
    await Promise.all(
      fixtures.map((fixture) => rm(fixture, { recursive: true, force: true })),
    );
  }
}, 120_000);
