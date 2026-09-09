import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { createBrowserDiagnostics } from "@tearleads/diagnostics/browser";
import { resolveNativeSentryConfig } from "./sentryConfig";

export async function configureNativeSentry() {
  if (
    !Capacitor.isNativePlatform() ||
    !import.meta.env.PROD ||
    !import.meta.env.VITE_SENTRY_DSN
  )
    return undefined;
  try {
    // Read the packaged allowlist before mounting React so initial boundary
    // failures can report. This local request is bounded and fails closed.
    const response = await fetch(
      new URL("/sentry-assets.json", window.location.href),
      { signal: AbortSignal.timeout(2000) },
    );
    if (!response.ok) return undefined;
    const manifest: unknown = await response.json();
    const config = resolveNativeSentryConfig(
      {
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
        commit: import.meta.env.VITE_SENTRY_COMMIT,
        platform: import.meta.env.VITE_SENTRY_PLATFORM,
        runtimePlatform: Capacitor.getPlatform(),
        productionBuild: import.meta.env.PROD,
        origin: window.location.origin,
      },
      manifest,
    );
    if (!config) return undefined;
    const diagnostics = createBrowserDiagnostics(config);
    // Flush pending JS errors when the WebView is about to be suspended.
    void App.addListener("pause", () => {
      void Promise.resolve(diagnostics.flush()).catch(() => undefined);
    }).catch(() => undefined);
    return diagnostics;
  } catch {
    return undefined;
  }
}
