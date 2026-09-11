import { createBrowserDiagnostics } from "@tearleads/diagnostics/browser";
import { resolveElectrobunSentryConfig } from "./sentryConfig";

export function configureElectrobunSentry() {
  try {
    const config = resolveElectrobunSentryConfig({
      // Inlined by the renderer defines (see ../rendererEnvironment), which
      // scripts/withSentryReleaseEnv.ts populates only for a release tier. A
      // local build leaves them undefined and the gate below keeps it local.
      dsn: process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_DSN,
      environment: process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT,
      commit: process.env.BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT,
      origin: window.location.origin,
      scriptUrl: import.meta.url,
    });
    return config ? createBrowserDiagnostics(config) : undefined;
  } catch {
    // Diagnostics must not prevent the application from booting.
    return undefined;
  }
}
