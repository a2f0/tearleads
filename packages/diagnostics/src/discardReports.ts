import { createClientReportEnvelope } from "@sentry/core";

/** API-only aggregate counters, containing no event data or identifiers. */
export function createDiscardReports() {
  let quantity = 0;
  let lastReportAt = Number.NEGATIVE_INFINITY;
  return {
    record() {
      quantity = Math.min(Number.MAX_SAFE_INTEGER, quantity + 1);
    },
    take() {
      const now = Date.now();
      if (quantity === 0 || now - lastReportAt < 60_000) return undefined;
      const report = createClientReportEnvelope([
        { reason: "sample_rate", category: "error", quantity },
      ]);
      quantity = 0;
      lastReportAt = now;
      return report;
    },
  };
}
