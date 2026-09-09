import { fileURLToPath } from "node:url";
import { loroWasmPlugin } from "@tearleads/loro/bun-plugin";
import { resolveSentryConfig } from "../src/diagnostics/sentryConfig";

const appDir = new URL("../", import.meta.url);

// The normal build-info wrapper stamps a short SHA for display. Sentry needs
// the separate full commit captured by deployment for exact artifact matching.
if (
  process.env.BUN_PUBLIC_SENTRY_DSN &&
  process.env.BUN_PUBLIC_APP_VARIANT === "app" &&
  !resolveSentryConfig({
    dsn: process.env.BUN_PUBLIC_SENTRY_DSN,
    environment: process.env.BUN_PUBLIC_SENTRY_ENVIRONMENT,
    commit: process.env.BUN_PUBLIC_SENTRY_COMMIT,
    variant: "app",
    origin: "https://app.invalid",
    scriptUrl: "https://app.invalid/chunk-check.js",
  })
)
  throw new Error(
    "Invalid Sentry build configuration: check the tier DSN, environment and full commit.",
  );

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
