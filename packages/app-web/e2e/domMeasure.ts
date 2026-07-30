const ATTACHED_MEASURE_TIMEOUT_MS = 10_000;
const ATTACHED_MEASURE_INTERVAL_MS = 50;

interface MeasureAttachedOptions {
  /** How long between retries. Exposed so the unit test need not wait. */
  intervalMs?: number | undefined;
  /** How long to keep retrying before giving up. */
  timeoutMs?: number | undefined;
}

/**
 * Take a DOM measurement, retrying until it runs against an element that is
 * still attached to the document. `read` returns `null` to mean "the element I
 * resolved is detached, try again".
 *
 * A detached node answers every question with a plausible lie:
 * `getBoundingClientRect()` is all zeros and `getComputedStyle()` returns empty
 * strings. A geometry assertion that lands on one therefore fails exactly the way
 * a real regression would — a strip that spans nothing, a cap that resolved to no
 * length — which is why these read as layout bugs rather than as the stale reads
 * they are.
 *
 * Landing on one is not hypothetical: the Explorer's sections hub mounts,
 * unmounts and remounts within ~300ms of a deep link, so a locator resolved by
 * the visibility gate can be an orphan by the time the measurement runs. Under
 * parallel load that window is wide enough to hit regularly.
 *
 * Covered by scripts/domMeasure.test.ts — `e2e/` is Playwright's, so this
 * helper's own unit test lives with the package's other bun tests.
 *
 * Deliberately guards attachment only. A *connected* element measuring zero is a
 * genuine failure and must still fail — retrying until the numbers look right
 * would be how a real regression gets waited out.
 */
export async function measureAttached<T>(
  what: string,
  read: () => Promise<T | null>,
  options: MeasureAttachedOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? ATTACHED_MEASURE_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? ATTACHED_MEASURE_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  const expired = () =>
    new Error(
      `${what}: never measured while attached to the document within ${timeoutMs}ms`,
    );

  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw expired();
    }

    const value = await readWithin(read(), remainingMs, expired);
    if (value !== null) {
      return value;
    }

    if (Date.now() >= deadline) {
      throw expired();
    }

    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
}

/**
 * Resolve `pending`, or give up once `remainingMs` has passed.
 *
 * The read itself has to be bounded, not just the interval between reads: a
 * locator whose element never comes back leaves `evaluate` waiting, and Playwright
 * bounds that only by the whole test's timeout. The failure would then say that
 * something timed out rather than which measurement was waiting for what — which
 * is the entire diagnostic value this helper adds.
 */
async function readWithin<T>(
  pending: Promise<T | null>,
  remainingMs: number,
  expired: () => Error,
): Promise<T | null> {
  // Mark the read handled up front. Abandoning it below leaves it in flight, and
  // an error arriving after the deadline would otherwise surface as an unhandled
  // rejection attributed to whatever test happened to be running by then.
  pending.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(expired()), remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
