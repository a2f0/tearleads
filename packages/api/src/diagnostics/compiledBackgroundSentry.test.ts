import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { diagnosticsBuild } from "../../scripts/diagnosticsBuild";

const root = resolve(import.meta.dirname, "../../../..");
const scripts = join(root, "packages/api/scripts");

test("the Worker deploy passes the diagnostics build to the bundle", async () => {
  // The retired blob GC and Stripe seat sync binaries once shipped without
  // these defines, which made `captureApiError` a permanent no-op; the Worker
  // receives them through `wrangler deploy --define`, one per printed line.
  const printer = Bun.spawn(
    [process.execPath, join(scripts, "workerDefines.ts")],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(printer.stdout).text();
  expect(await printer.exited).toBe(0);
  const defines = new Map(
    output
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(":");
        return [line.slice(0, separator), line.slice(separator + 1)] as const;
      }),
  );
  expect([...defines.keys()].sort()).toEqual([
    "API_BUILD_VERSION",
    "API_DIAGNOSTICS_BUILD",
  ]);
  const build = JSON.parse(defines.get("API_DIAGNOSTICS_BUILD") ?? "null");
  expect(build).toEqual(diagnosticsBuild(root));
  expect(build.sourcePaths).toContain("/packages/api/src/worker/index.ts");
  expect(JSON.parse(defines.get("API_BUILD_VERSION") ?? "null")).toSatisfy(
    (value: unknown) => value === null || typeof value === "number",
  );
});

test("a compiled binary reports a swallowed background failure as a handled, sanitized event", async () => {
  const directory = await mkdtemp(join(tmpdir(), "api-background-build-"));
  const deployed = await mkdtemp(join(tmpdir(), "api-background-deploy-"));
  const metadata = diagnosticsBuild(root);
  try {
    await Bun.write(
      join(directory, "fixture.ts"),
      `
import { publishBestEffort } from ${JSON.stringify(join(root, "packages/api/src/utils/publishBestEffort.ts"))};
let sent;
const received = new Promise(resolve => { sent = resolve; });
globalThis.fetch = async (_url, init) => {
  console.log(String(init.body)); sent();
  return new Response(null, { status: 200 });
};
const deadline = setTimeout(() => { process.exit(2); }, 10000);
const error = Object.assign(new Error("SYNTHETIC_PRIVATE_DATABASE_VALUE"), { code: "ECONNREFUSED" });
error.stack = "Error: SYNTHETIC_PRIVATE_DATABASE_VALUE\\n    at connect (node:net:1182:12)";
console.error = () => {};
await publishBestEffort(async () => { throw error; }, { type: "session_revoked", sessionId: "SYNTHETIC_PRIVATE_SESSION" }, "synthetic");
await received;
clearTimeout(deadline);
`,
    );
    await Bun.write(
      join(directory, "build.ts"),
      `
import { apiDiagnosticsBuildOptions } from ${JSON.stringify(join(scripts, "diagnosticsBuild.ts"))};
const result = await Bun.build({
  entrypoints: [${JSON.stringify(join(directory, "fixture.ts"))}],
  compile: { outfile: ${JSON.stringify(join(directory, "fixture"))} }, target: "bun",
  ...apiDiagnosticsBuildOptions(${JSON.stringify(root)}),
});
if (!result.success) process.exit(1);
`,
    );
    const build = Bun.spawn([process.execPath, join(directory, "build.ts")], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await build.exited).toBe(0);
    await copyFile(join(directory, "fixture"), join(deployed, "fixture"));
    // Deployment copies only the executable; no source or sibling map survives.
    await rm(directory, { recursive: true, force: true });
    const run = Bun.spawn([join(deployed, "fixture")], {
      cwd: deployed,
      env: {
        ...process.env,
        API_SENTRY_DSN: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
        API_SENTRY_ENVIRONMENT: "production",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(run.stdout).text();
    expect(await run.exited).toBe(0);
    expect(output).not.toContain("SYNTHETIC_PRIVATE_DATABASE_VALUE");
    expect(output).not.toContain(root);
    expect(output).not.toContain(directory);
    expect(output).not.toContain(deployed);
    const event = JSON.parse(output.trim().split("\n")[2] ?? "{}");
    expect(event.release).toBe(`tearleads-api@${metadata.commit}`);
    expect(event.tags.diagnostic_source).toBe("background-error");
    expect(event.tags.api_operation).toBe("realtime.publish");
    expect(event.tags.api_error_code).toBe("ECONNREFUSED");
    expect(event.tags.api_stack).toBe("capture-site");
    expect(output).not.toContain("SYNTHETIC_PRIVATE_SESSION");
    expect(event.exception.values[0].value).toBe(
      "API realtime event publication failed: connection refused (ECONNREFUSED)",
    );
    // A dropped source would send nothing; an unknown one would ship as a crash.
    expect(event.exception.values[0].mechanism).toEqual({
      type: "generic",
      handled: true,
    });
    expect(event.exception.values[0].stacktrace.frames).toContainEqual(
      expect.objectContaining({
        filename: "app:///packages/api/src/utils/publishBestEffort.ts",
        in_app: true,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(deployed, { recursive: true, force: true });
  }
}, 60000);
