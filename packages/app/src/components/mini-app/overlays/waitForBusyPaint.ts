/** Longer than a frame at any refresh rate, short enough to go unnoticed. */
export const BUSY_PAINT_FALLBACK_MS = 100;

/**
 * Resolves once the browser has painted the frame that follows a busy-state
 * update. Await it after setting a busy flag and before starting work that
 * blocks the main thread (key generation, sealing, signature checks): a
 * spinner the browser never painted cannot animate, even on the compositor,
 * so starting the work in the same task leaves it frozen or missing.
 *
 * The animation-frame callback runs just before that frame paints; the
 * timeout after it runs once the frame has been produced. Hidden tabs and
 * windows pause animation frames, so a bounded timer also resolves it: the
 * action must not stall until the app is shown again.
 */
export function waitForBusyPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    const fallback = setTimeout(resolve, BUSY_PAINT_FALLBACK_MS);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Waits for the busy state to paint, then runs `run` only if the operation is
 * still current (the user may switch scope during that frame). Resolves to
 * undefined when it was abandoned.
 */
export async function runAfterBusyPaint<T>(
  isActive: () => boolean,
  run: () => Promise<T>,
): Promise<T | undefined> {
  await waitForBusyPaint();
  return isActive() ? run() : undefined;
}
