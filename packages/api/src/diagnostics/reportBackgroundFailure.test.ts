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

test("a nested aggregate reports its leaves, not an inner construction site", () => {
  // runBlobMaintenance wraps each phase's own aggregate inside the one it
  // throws, so a single-level unwrap would report that inner aggregate — whose
  // stack is again where it was constructed, not where reclamation failed.
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  try {
    const stageFailure = new Error("SYNTHETIC_PRIVATE_STAGE_VALUE");
    const reclaimFailure = new Error("SYNTHETIC_PRIVATE_RECLAIM_VALUE");
    reportBackgroundFailure(
      new AggregateError(
        [
          reclaimFailure,
          new AggregateError([stageFailure], "stage cleanup failed"),
        ],
        "Blob maintenance failed",
      ),
    );
    expect(capture.mock.calls.map(([reported]) => reported)).toEqual([
      reclaimFailure,
      stageFailure,
    ]);

    // A cyclic aggregate is bounded by depth rather than looping forever.
    capture.mockClear();
    const cyclic = new AggregateError([], "cyclic");
    cyclic.errors = [cyclic];
    expect(() => reportBackgroundFailure(cyclic)).not.toThrow();
    expect(capture).toHaveBeenCalledTimes(1);
  } finally {
    capture.mockRestore();
  }
});

test("an aggregate reports its constituents, bounded, not its own stack", () => {
  // A sweep aggregates one error per item, and the sanitizer keeps only the
  // first exception value — so reporting the aggregate itself would ship its
  // construction site and discard every stack that identifies the real fault.
  const capture = spyOn(sentry, "captureApiError").mockImplementation(
    () => undefined,
  );
  try {
    const failures = Array.from(
      { length: 9 },
      (_unused, index) => new Error(`SYNTHETIC_PRIVATE_ITEM_${index}`),
    );
    reportBackgroundFailure(new AggregateError(failures, "sweep failed"));
    expect(capture).toHaveBeenCalledTimes(5);
    for (const [reported] of capture.mock.calls) {
      expect(failures as readonly unknown[]).toContain(reported);
    }

    // An empty aggregate still carries its own message and stack.
    capture.mockClear();
    const empty = new AggregateError([], "sweep failed");
    reportBackgroundFailure(empty);
    expect(capture).toHaveBeenCalledWith(empty, "background-error");
  } finally {
    capture.mockRestore();
  }
});
