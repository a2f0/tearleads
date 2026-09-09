import { createBrowserDiagnostics } from "@tearleads/diagnostics/browser";
import { resolveSentryConfig, type SentryInput } from "./sentryConfig";

export function configureSentry(input: SentryInput) {
  try {
    const config = resolveSentryConfig(input);
    return config ? createBrowserDiagnostics(config) : undefined;
  } catch {
    // Diagnostics must not prevent the application from booting.
    return undefined;
  }
}
