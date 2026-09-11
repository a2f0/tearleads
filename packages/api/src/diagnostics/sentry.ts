import {
  createServerDiagnostics,
  type ServerErrorSource,
} from "@tearleads/diagnostics/server";
import { resolveApiSentryConfig } from "./sentryConfig";

// Replaced by the executable builder with code paths and a commit from this
// checkout. Runtime environment variables cannot supply the frame allowlist.
declare const API_DIAGNOSTICS_BUILD: {
  commit: string;
  sourceRoot: string;
  sourcePaths: readonly string[];
};

function configureDiagnostics() {
  if (typeof API_DIAGNOSTICS_BUILD === "undefined") return undefined;
  try {
    const { API_SENTRY_DSN, API_SENTRY_ENVIRONMENT } = process.env;
    const config = resolveApiSentryConfig({
      ...API_DIAGNOSTICS_BUILD,
      dsn: API_SENTRY_DSN,
      environment: API_SENTRY_ENVIRONMENT,
    });
    return config ? createServerDiagnostics(config) : undefined;
  } catch {
    return undefined;
  }
}

const diagnostics = configureDiagnostics();

export function captureApiError(
  error: unknown,
  source: ServerErrorSource,
): void {
  try {
    diagnostics?.captureError(error, source);
  } catch {
    // Observability must not alter the application's error response.
  }
}

/**
 * Drain pending reports before a short-lived process exits. The long-running
 * server never needs this — its transport outlives every request — but a
 * maintenance binary can finish its work and exit while a capture is still in
 * flight, losing exactly the failure the run existed to surface.
 */
export async function flushApiDiagnostics(): Promise<void> {
  try {
    await diagnostics?.flush();
  } catch {
    // A failed flush must not change the exit status of the work itself.
  }
}
