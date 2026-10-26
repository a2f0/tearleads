import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workerDiagnosticsBuild } from "../../scripts/diagnosticsBuild";

// Execute the real Sentry parser and both privacy passes inside workerd. The
// transport is intercepted inside the fixture, so no event leaves the machine.
test("Worker diagnostics retain bundled positions without private error data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tearleads-worker-frames-"));
  const apiRoot = resolve(import.meta.dirname, "../..");
  const build = workerDiagnosticsBuild(resolve(apiRoot, "../.."));
  const runtimeConfig = Bun.JSONC.parse(
    await Bun.file(join(apiRoot, "wrangler.jsonc")).text(),
  ) as {
    compatibility_date: string;
    compatibility_flags: string[];
  };
  try {
    await Bun.write(
      join(directory, "index.ts"),
      `
import { createServerDiagnostics } from ${JSON.stringify(fileURLToPath(import.meta.resolve("@tearleads/diagnostics/server")))};
import { resolveApiSentryConfig } from ${JSON.stringify(join(import.meta.dirname, "sentryConfig.ts"))};
export default { async fetch() {
  const sent = [];
  globalThis.fetch = async (_url, init) => { sent.push(String(init.body)); return new Response(null, {status: 200}); };
  const config = resolveApiSentryConfig({ ...${JSON.stringify(build)}, dsn: "https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1", environment: "staging" });
  if (!config) throw new Error("Expected diagnostics config");
  const client = createServerDiagnostics(config);
  const captured = new Error("PRIVATE_WORKER_REQUEST_VALUE", { cause: new Error("PRIVATE_CAUSE_VALUE") });
  client.captureError(captured, "request-error", "http.request");
  let customGetterCalled = false;
  const customCause = new Error("PRIVATE_CUSTOM_CAUSE");
  Object.defineProperty(customCause, "stack", { get() { customGetterCalled = true; throw new Error("custom getter ran"); } });
  client.captureError(new Error("PRIVATE_CUSTOM_ROOT", { cause: customCause }), "background-error");
  await client.flush();
  await client.close();
  return Response.json({sent, stack: captured.stack, customGetterCalled});
}};
`,
    );
    const bundle = await Bun.build({
      entrypoints: [join(directory, "index.ts")],
      target: "browser",
      external: ["node:*"],
    });
    expect(bundle.success).toBe(true);
    // Miniflare otherwise adds a file:/// development path. Use the deployed
    // module name so workerd produces production-shaped stacks itself.
    await Bun.write(
      join(directory, "index.js"),
      `${await bundle.outputs[0]?.text()}\n//# sourceURL=index.js\n`,
    );
    // Use the workerd harness installed with Wrangler. Wrangler dev itself
    // unconditionally appends local file URLs, which deployed Workers lack.
    const runner = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const { Miniflare } = createRequire(${JSON.stringify(import.meta.resolve("wrangler"))})("miniflare");
const worker = new Miniflare({ workers: [{ config: {
  name: "diagnostics-test", type: "worker",
  compatibilityDate: ${JSON.stringify(runtimeConfig.compatibility_date)},
  compatibilityFlags: ${JSON.stringify(runtimeConfig.compatibility_flags)},
  manifest: { mainModule: "index.js", modules: {
    "index.js": { type: "esm", contents: readFileSync(${JSON.stringify(join(directory, "index.js"))}, "utf8") },
  } },
} }] });
try { console.log("ENVELOPES:" + await (await worker.dispatchFetch("http://localhost/")).text()); }
finally { await worker.dispose(); }
`,
      ],
      {
        cwd: apiRoot,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 45_000,
      },
    );
    const [output, errors, code] = await Promise.all([
      new Response(runner.stdout).text(),
      new Response(runner.stderr).text(),
      runner.exited,
    ]);
    expect({ code, errors }).toMatchObject({ code: 0 });
    const line = output
      .split("\n")
      .find((line) => line.startsWith("ENVELOPES:"));
    if (!line) throw new Error(`No envelopes: ${output} ${errors}`);
    const {
      sent: envelopes,
      stack,
      customGetterCalled,
    }: {
      sent: string[];
      stack: string;
      customGetterCalled: boolean;
    } = JSON.parse(line.slice("ENVELOPES:".length));
    expect(envelopes).toHaveLength(2);
    expect(customGetterCalled).toBe(false);
    expect(envelopes.join("\n")).not.toContain("PRIVATE_");
    const envelope = envelopes[0] ?? "";
    expect(envelope).not.toContain("PRIVATE_WORKER_REQUEST_VALUE");
    expect(envelope).not.toContain(directory);
    const event = JSON.parse(envelope.split("\n")[2] ?? "{}");
    expect(stack).toContain("index.js:");
    expect(stack).not.toContain("file://");
    expect(event.tags.api_stack).toBe("original");
    expect(event.exception.values).toHaveLength(2);
    for (const value of event.exception.values)
      expect(value.stacktrace.frames.length).toBeGreaterThan(0);
    expect(event.exception.values[0].stacktrace.frames).toContainEqual({
      filename: "app:///index.js",
      lineno: expect.any(Number),
      colno: expect.any(Number),
      in_app: true,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}, 60_000);
