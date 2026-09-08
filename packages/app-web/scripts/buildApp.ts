import { fileURLToPath } from "node:url";

const appDir = new URL("../", import.meta.url);

const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("src/index.html", appDir))],
  outdir: fileURLToPath(new URL("dist/", appDir)),
  sourcemap: "linked",
  target: "browser",
  minify: true,
  env: "BUN_PUBLIC_*",
  publicPath: "/",
  plugins: [
    {
      name: "loro-inline-wasm",
      setup(build) {
        // Loro's default production entry uses synchronous XHR for an asset
        // Bun does not emit. Sync XHR also bypasses the offline service worker.
        // Its supported base64 entry embeds WASM in the versioned JS bundle.
        build.onResolve({ filter: /^loro-crdt$/ }, () => ({
          path: fileURLToPath(import.meta.resolve("loro-crdt/base64")),
        }));
      },
    },
  ],
});

if (!result.success) {
  throw new AggregateError(result.logs, "Failed to build app-web.");
}
