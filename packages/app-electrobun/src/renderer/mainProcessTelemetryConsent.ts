import type { CollectionConsent } from "@tearleads/diagnostics/browser";
import {
  ELECTROBUN_TELEMETRY_CONSENT_HEADER,
  ELECTROBUN_TELEMETRY_CONSENT_PATH,
} from "../telemetryConsentBridge";

/**
 * Tells the Bun main process the user's anonymous-telemetry choice now and on
 * every change, so its own failure reports follow the same opt-in. Posts run
 * one at a time and each sends the choice current when it leaves, so a quick
 * on-then-off cannot land out of order and leave reporting on. The main
 * process starts with reporting off, and a failed post leaves it as it was.
 */
export function shareTelemetryConsentWithMainProcess(
  consent: CollectionConsent,
): void {
  let posting: Promise<void> = Promise.resolve();
  const post = () => {
    posting = posting.then(() =>
      fetch(ELECTROBUN_TELEMETRY_CONSENT_PATH, {
        headers: {
          [ELECTROBUN_TELEMETRY_CONSENT_HEADER]: consent.enabled()
            ? "enabled"
            : "disabled",
        },
        method: "POST",
      }).then(
        () => undefined,
        () => undefined,
      ),
    );
  };
  post();
  consent.subscribe(post);
}
