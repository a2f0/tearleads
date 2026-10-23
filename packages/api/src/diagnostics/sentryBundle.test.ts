import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { workerDiagnosticsBuild } from "../../scripts/diagnosticsBuild";

// Exercise the actual pinned Wrangler, including Loro's external WASM module.
// Both publish attempts are offline dry runs; no Worker or Sentry event is sent.
test("the source-map upload bundle survives Wrangler's no-bundle deploy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "api-sentry-bundle-"));
  const apiRoot = resolve(import.meta.dirname, "../..");
  const built = join(directory, "built");
  const ready = join(directory, "ready");
  async function deploy(args: string[]) {
    const child = Bun.spawn(
      [
        process.execPath,
        "x",
        "--no-install",
        "wrangler",
        "deploy",
        "--config",
        join(apiRoot, "wrangler.jsonc"),
        "--env",
        "local",
        "--dry-run",
        ...args,
      ],
      {
        cwd: apiRoot,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000,
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, output: stdout + stderr };
  }
  try {
    const first = await deploy([
      "--outdir",
      built,
      "--define",
      `API_DIAGNOSTICS_BUILD:${JSON.stringify(workerDiagnosticsBuild(resolve(apiRoot, "../..")))}`,
    ]);
    expect(first.code, first.output).toBe(0);
    const second = await deploy([
      join(built, "index.js"),
      "--no-bundle",
      "--outdir",
      ready,
    ]);
    expect(second.code, second.output).toBe(0);
    const modules = (await readdir(built)).filter(
      (name) => name.endsWith(".js") || name.endsWith(".wasm"),
    );
    expect(modules.some((name) => name.endsWith(".wasm"))).toBe(true);
    for (const name of modules) {
      const digest = async (folder: string) =>
        createHash("sha256")
          .update(await readFile(join(folder, name)))
          .digest("hex");
      expect(await digest(ready)).toBe(await digest(built));
    }
    expect(await readFile(join(built, "index.js"), "utf8")).toContain(
      "//# sourceMappingURL=index.js.map",
    );
    const map = JSON.parse(await readFile(join(built, "index.js.map"), "utf8"));
    expect(map.mappings.length).toBeGreaterThan(0);
    expect(map.sourcesContent.length).toBeGreaterThan(0);

    // --outdir copies code modules, not maps. Prove --no-bundle reads the map
    // beside the input bundle by removing it and requiring preparation to fail.
    await rename(join(built, "index.js.map"), join(built, "disabled.map"));
    const missing = await deploy([join(built, "index.js"), "--no-bundle"]);
    expect(missing.code).not.toBe(0);
    expect(missing.output).toContain("Invalid source map path");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
