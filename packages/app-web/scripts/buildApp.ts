import { fileURLToPath } from "node:url";
import { loroWasmPlugin } from "@tearleads/loro/bun-plugin";
import { assertSentryBuildOutput } from "./sentryBuild";

const appDir = new URL("../", import.meta.url);

const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("src/index.html", appDir))],
  outdir: fileURLToPath(new URL("dist/", appDir)),
  sourcemap: "linked",
  target: "browser",
  minify: true,
  env: "BUN_PUBLIC_*",
  publicPath: "/",
  plugins: [loroWasmPlugin],
});

if (!result.success) {
  throw new AggregateError(result.logs, "Failed to build app-web.");
}

// Check the actual emitted entry. A naming or chunk-layout change must fail
// deployment rather than silently disable the browser's strict frame filter.
assertSentryBuildOutput(
  {
    dsn: process.env.BUN_PUBLIC_SENTRY_DSN,
    environment: process.env.BUN_PUBLIC_SENTRY_ENVIRONMENT,
    commit: process.env.BUN_PUBLIC_SENTRY_COMMIT,
    variant: process.env.BUN_PUBLIC_APP_VARIANT,
  },
  fileURLToPath(new URL("dist/", appDir)),
  result.outputs.map((output) => output.path),
);
