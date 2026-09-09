import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { sentryAssetsPlugin } from "../../scripts/sentryAssetsPlugin";

test("Vite's packaged allowlist contains the exact JS chunks, without maps or other assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sentry-manifest-"));
  try {
    await Bun.write(
      join(directory, "entry.js"),
      'import "./style.css"; globalThis.loadDetails = () => import("./details.js");',
    );
    await Bun.write(
      join(directory, "details.js"),
      'export const value = "synthetic";',
    );
    await Bun.write(join(directory, "style.css"), "body { color: red; }");
    const config = {
      dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
      commit: "b".repeat(40),
      platform: "ios",
      environment: "staging",
    };
    await build({
      root: directory,
      configFile: false,
      logLevel: "silent",
      plugins: [sentryAssetsPlugin(config)],
      build: {
        sourcemap: "hidden",
        rollupOptions: { input: join(directory, "entry.js") },
      },
    });
    const output = join(directory, "dist");
    const manifest = JSON.parse(
      await readFile(join(output, "sentry-assets.json"), "utf8"),
    );
    const scripts = await Array.fromAsync(
      new Bun.Glob("assets/*.js").scan(output),
    );
    expect(scripts).toHaveLength(2);
    expect(manifest).toEqual({
      commit: config.commit,
      platform: "ios",
      environment: "staging",
      paths: expect.any(Array),
    });
    expect(manifest.paths.sort()).toEqual(
      scripts.map((path) => `/${path}`).sort(),
    );
    for (const path of scripts) {
      expect(await Bun.file(join(output, `${path}.map`)).exists()).toBe(true);
      expect(await readFile(join(output, path), "utf8")).not.toContain(
        "sourceMappingURL",
      );
    }
    await expect(
      build({
        root: directory,
        configFile: false,
        logLevel: "silent",
        plugins: [sentryAssetsPlugin(config)],
        build: {
          rollupOptions: {
            input: join(directory, "entry.js"),
            output: { chunkFileNames: "assets/@[name]-[hash].js" },
          },
        },
      }),
    ).rejects.toThrow("Native Sentry assets must use");
    await build({
      root: directory,
      configFile: false,
      logLevel: "silent",
      plugins: [sentryAssetsPlugin({})],
      build: { rollupOptions: { input: join(directory, "entry.js") } },
    });
    expect(await Bun.file(join(output, "sentry-assets.json")).exists()).toBe(
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
