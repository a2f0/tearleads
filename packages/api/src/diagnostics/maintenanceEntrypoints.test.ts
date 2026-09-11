import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const scripts = join(root, "packages/api/scripts");
const reporter = join(import.meta.dirname, "reportBackgroundFailure.ts");
const sentry = join(import.meta.dirname, "sentry.ts");
const runtime = join(root, "packages/api/src/services/runtime.ts");
// Mocked by the specifier the entrypoints import; the preload lives outside the
// workspace, so its real exports are resolved here and passed in by path.
const postgresSpecifier = "@tearleads/api-shared/postgres";
const postgresPath = Bun.resolveSync(
  postgresSpecifier,
  join(root, "packages/api"),
);

/**
 * Runs a maintenance entrypoint for real, with only its outermost dependencies
 * replaced, so the assertions cover the script's own catch and `finally` rather
 * than a copy of them. `API_DIAGNOSTICS_BUILD` exists only in a compiled binary,
 * so the reporter itself is stubbed here; `compiledBackgroundSentry.test.ts`
 * covers the envelope a built executable actually sends.
 */
async function runEntrypoint(
  entrypoint: string,
  failingModule: string,
  failingExport: string,
) {
  const directory = await mkdtemp(join(tmpdir(), "api-maintenance-"));
  try {
    const preload = join(directory, "preload.ts");
    await Bun.write(
      preload,
      `
import { mock } from "bun:test";
mock.module(${JSON.stringify(reporter)}, () => ({
  reportBackgroundFailure: (error) => {
    console.log("REPORTED " + (error instanceof Error ? error.message : "non-error"));
  },
}));
mock.module(${JSON.stringify(sentry)}, () => ({
  captureApiError: () => undefined,
  flushApiDiagnostics: async () => { console.log("FLUSHED"); },
}));
mock.module(${JSON.stringify(runtime)}, () => ({
  getDefaultApiServiceRuntime: () => ({}),
}));
// Spread the real module: replacing it wholesale would drop the sibling
// exports these entrypoints' transitive imports resolve at load time.
const postgres = await import(${JSON.stringify(postgresPath)});
mock.module(${JSON.stringify(postgresSpecifier)}, () => ({
  ...postgres,
  closeApiDatabase: async () => { console.log("DB CLOSED"); },
}));
mock.module(${JSON.stringify(failingModule)}, () => ({
  ${failingExport}: async () => { throw new Error("SYNTHETIC_PRIVATE_MAINTENANCE_VALUE"); },
}));
`,
    );
    const run = Bun.spawn(
      [process.execPath, "--preload", preload, join(scripts, entrypoint)],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(run.stdout).text();
    return { exitCode: await run.exited, output };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("blob GC reports its swallowed failure and flushes before exiting", async () => {
  const { exitCode, output } = await runEntrypoint(
    "blobGc.ts",
    join(root, "packages/api/src/services/blobs/blobMaintenance.ts"),
    "runBlobMaintenance",
  );
  expect(output).toContain("REPORTED SYNTHETIC_PRIVATE_MAINTENANCE_VALUE");
  // A fire-and-forget capture in a process that exits immediately would be
  // dropped in flight, so the flush must run and must follow the report.
  expect(output.indexOf("FLUSHED")).toBeGreaterThan(output.indexOf("REPORTED"));
  // Reporting must not disturb the run's own outcome.
  expect(output).toContain("DB CLOSED");
  expect(exitCode).toBe(1);
}, 30000);

test("billing maintenance reports each failed phase and flushes before exiting", async () => {
  const { exitCode, output } = await runEntrypoint(
    "stripeSeatSync.ts",
    join(root, "packages/api/src/services/billing/organizationTrialExpiry.ts"),
    "expireOrganizationTrials",
  );
  expect(output).toContain("REPORTED SYNTHETIC_PRIVATE_MAINTENANCE_VALUE");
  expect(output.indexOf("FLUSHED")).toBeGreaterThan(output.indexOf("REPORTED"));
  // Every phase runs and reports independently: one failure is not fatal to
  // the rest, and each is its own report rather than a single aggregate.
  expect(output.match(/REPORTED /gu)).toHaveLength(3);
  expect(output).toContain("DB CLOSED");
  expect(exitCode).toBe(1);
}, 30000);
