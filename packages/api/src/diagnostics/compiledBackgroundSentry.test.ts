import { expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { diagnosticsBuild } from "../../scripts/diagnosticsBuild";

const root = resolve(import.meta.dirname, "../../../..");
const scripts = join(root, "packages/api/scripts");

test("every compiled API binary embeds the diagnostics build, or its reporter is dead code", async () => {
  const builders = (await readdir(scripts)).filter((name) =>
    /^build.+Executable\.ts$/u.test(name),
  );
  // Blob GC and Stripe seat sync shipped without these defines, which made
  // `captureApiError` a permanent no-op inside those binaries.
  expect(builders).toContain("buildBlobGcExecutable.ts");
  expect(builders).toContain("buildStripeSeatSyncExecutable.ts");
  for (const builder of builders) {
    const source = await readFile(join(scripts, builder), "utf8");
    expect(source).toContain("...apiDiagnosticsBuildOptions(repoRoot),");
  }
});

test("a compiled binary reports a swallowed background failure as a handled, sanitized event", async () => {
  const directory = await mkdtemp(join(tmpdir(), "api-background-build-"));
  const deployed = await mkdtemp(join(tmpdir(), "api-background-deploy-"));
  const metadata = diagnosticsBuild(root);
  try {
    await Bun.write(
      join(directory, "fixture.ts"),
      `
import { reportBackgroundFailure } from ${JSON.stringify(join(import.meta.dirname, "reportBackgroundFailure.ts"))};
import { bytesToBase64 } from ${JSON.stringify(join(root, "packages/encoding/src/base64.ts"))};
let sent;
const received = new Promise(resolve => { sent = resolve; });
globalThis.fetch = async (_url, init) => {
  console.log(String(init.body)); sent();
  return new Response(null, { status: 200 });
};
const deadline = setTimeout(() => { process.exit(2); }, 10000);
try { bytesToBase64(null); }
catch (error) {
  error.message = "SYNTHETIC_PRIVATE_DATABASE_VALUE";
  reportBackgroundFailure(error);
}
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
    // A dropped source would send nothing; an unknown one would ship as a crash.
    expect(event.exception.values[0].mechanism).toEqual({
      type: "generic",
      handled: true,
    });
    expect(event.exception.values[0].stacktrace.frames).toContainEqual(
      expect.objectContaining({
        filename: "app:///packages/encoding/src/base64.ts",
        in_app: true,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(deployed, { recursive: true, force: true });
  }
}, 60000);
