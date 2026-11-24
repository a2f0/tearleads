import {
  type CollectionConsent,
  createBrowserDiagnostics,
} from "@tearleads/diagnostics/browser";
import { resolveSentryConfig, type SentryInput } from "./sentryConfig";

export function configureSentry(
  input: SentryInput,
  consent: CollectionConsent,
) {
  try {
    const config = resolveSentryConfig(input);
    return config ? createBrowserDiagnostics(config, consent) : undefined;
  } catch {
    // Diagnostics must not prevent the application from booting.
    return undefined;
  }
}
