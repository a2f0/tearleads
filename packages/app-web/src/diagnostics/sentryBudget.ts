import type { ErrorEvent } from "@sentry/browser";

// Bound network volume and memory even if a background retry loop keeps failing.
// Signatures are built only from the already-sanitized event, never raw errors.
export function createSentryEventBudget() {
  const seen = new Set<string>();
  let windowStart = Date.now();
  let windowCount = 0;
  return (event: ErrorEvent): boolean => {
    const signature = JSON.stringify([event.exception, event.tags]);
    if (seen.size >= 20 || seen.has(signature)) return false;
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      windowCount = 0;
    }
    if (windowCount >= 5) return false;
    seen.add(signature);
    windowCount++;
    return true;
  };
}
