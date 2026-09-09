import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a compiled Bun executable reports mapped code positions without machine paths or error text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tearleads-diagnostics-"));
  try {
    await Bun.write(
      join(directory, "fixture.ts"),
      `
import { createServerDiagnostics } from ${JSON.stringify(join(import.meta.dirname, "server.ts"))};
globalThis.fetch = async (_url, init) => { console.log(String(init.body)); return new Response(null, { status: 200 }); };
const client = createServerDiagnostics({
  dsn: "https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1",
  environment: "staging", release: "tearleads-api@${"b".repeat(40)}", dist: "staging",
  runtime: "api", origin: "", scriptPath: "", serverSourceRoot: ${JSON.stringify(directory)}, scriptPaths: new Set(["/fixture.ts"])
});
client.captureError(new TypeError("SYNTHETIC_PRIVATE_DATABASE_VALUE"), "request-error");
await client.flush();
await client.close();
`,
    );
    const build = Bun.spawn(
      [
        process.execPath,
        "build",
        "fixture.ts",
        "--compile",
        "--sourcemap",
        "--outfile",
        "fixture",
      ],
      { cwd: directory, stdout: "pipe", stderr: "pipe" },
    );
    expect(await build.exited).toBe(0);
    const run = Bun.spawn([join(directory, "fixture")], {
      cwd: tmpdir(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(run.stdout).text();
    expect(await run.exited).toBe(0);
    expect(output).not.toContain(directory);
    expect(output).not.toContain("SYNTHETIC_PRIVATE_DATABASE_VALUE");
    const event = JSON.parse(output.trim().split("\n")[2] ?? "{}");
    expect(event.exception.values[0].stacktrace.frames).toEqual([
      { filename: "app:///fixture.ts", lineno: 9, colno: 25, in_app: true },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
