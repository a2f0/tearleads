// Bounded retry schedule shared by the roster-profile editor's container
// resolution and the org switcher's index catch-up: ~20s of 500ms retries
// before the caller concludes the data is genuinely unavailable.
const BOUNDED_RETRY_DELAY_MS = 500;
const BOUNDED_RETRY_LIMIT = 40;

interface BoundedRetrySchedule {
  /** Clears any pending tick and marks the schedule cancelled. */
  cancel: () => void;
  /** True once cancel() ran; in-flight work must stop reporting. */
  readonly cancelled: boolean;
  /** True once the retry budget is spent. */
  readonly exhausted: boolean;
  /** Consumes one retry and runs the tick after the shared delay. */
  scheduleNext: () => void;
  /** Runs the tick after the shared delay without consuming a retry. */
  start: () => void;
}

export function createBoundedRetrySchedule(
  tick: () => void,
): BoundedRetrySchedule {
  let attempts = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    timer = setTimeout(tick, BOUNDED_RETRY_DELAY_MS);
  };

  return {
    cancel: () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
    get cancelled() {
      return cancelled;
    },
    get exhausted() {
      return attempts >= BOUNDED_RETRY_LIMIT;
    },
    scheduleNext: () => {
      attempts += 1;
      start();
    },
    start,
  };
}
