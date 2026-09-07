import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const biomeBin = join(repoRoot, "node_modules/.bin/biome");

test("production promise checks resolve SDK calls through ignored build output", async () => {
  const fixtures: string[] = [];
  let stopChild: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    for (const fixture of fixtures)
      rmSync(fixture, { recursive: true, force: true });
  };
  const interrupt = (signal: NodeJS.Signals) => {
    stopChild?.();
    cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    // Use the real package roots so imports and gitignored SDK declarations
    // resolve exactly as they do in the production scan. Always remove inputs.
    for (const packageName of ["api", "app", "client-sdk", "crypto"]) {
      const fixture = mkdtempSync(
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
        writeFileSync(join(fixture, name), source);
      }
    }
    const child = Bun.spawn(
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
      { cwd: repoRoot, detached: true, stdout: "pipe", stderr: "pipe" },
    );
    // The launcher spawns a native child; stop their process group together.
    stopChild = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ESRCH"
        )
          throw error;
      }
    };
    timeout = setTimeout(stopChild, 60_000);
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(1);
    // Biome 2.5.12's JSON reporter uses string location paths.
    const report = JSON.parse(stdout) as {
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
    clearTimeout(timeout);
    stopChild?.();
    cleanup();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}, 120_000);
