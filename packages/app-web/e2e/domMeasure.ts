const ATTACHED_MEASURE_TIMEOUT_MS = 10_000;
const ATTACHED_MEASURE_INTERVAL_MS = 50;

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
 * Deliberately guards attachment only. A *connected* element measuring zero is a
 * genuine failure and must still fail — retrying until the numbers look right
 * would be how a real regression gets waited out.
 */
export async function measureAttached<T>(
  what: string,
  read: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + ATTACHED_MEASURE_TIMEOUT_MS;
  for (;;) {
    const value = await read();
    if (value !== null) {
      return value;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `${what}: never measured while attached to the document within ${ATTACHED_MEASURE_TIMEOUT_MS}ms`,
      );
    }

    await new Promise((resolve) => {
      setTimeout(resolve, ATTACHED_MEASURE_INTERVAL_MS);
    });
  }
}
