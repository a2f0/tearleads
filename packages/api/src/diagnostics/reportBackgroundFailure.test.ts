import { expect, spyOn, test } from "bun:test";
import { reportBackgroundFailure } from "./reportBackgroundFailure";
import * as sentry from "./sentry";

// A `void` return accepts any value, so the wrapper must also survive a reporter
// that hands back a rejected promise: an unhandled rejection here would crash
// the process the swallowed failure was protecting.
const outcomes = {
  success: () => undefined,
  throw: () => {
    throw new Error("Diagnostic transport unavailable");
  },
  reject: () => Promise.reject(new Error("Diagnostic transport unavailable")),
} satisfies Record<string, () => unknown>;

test.each(Object.entries(outcomes))(
  "a swallowed failure reaches the API reporter without surfacing: %s",
  async (_name, outcome) => {
    const capture = spyOn(sentry, "captureApiError").mockImplementation(
      outcome,
    );
    const failure = new Error("SYNTHETIC_PRIVATE_BROKER_VALUE");
    try {
      // The capture is synchronous, so a caller that exits its turn immediately
      // afterwards has already reported.
      expect(reportBackgroundFailure(failure)).toBeUndefined();
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith(failure, "background-error");
      // Give a rejected report a turn to become an unhandled rejection.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      capture.mockRestore();
    }
  },
);
