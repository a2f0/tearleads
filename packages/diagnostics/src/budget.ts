import type { ErrorEvent } from "@sentry/core";

// Bound network volume and memory even if a background retry loop keeps failing.
// Signatures are built only from the already-sanitized event, never raw errors.
export function createSentryEventBudget(
  resetAfterMs = Number.POSITIVE_INFINITY,
) {
  const seen = new Set<string>();
  let budgetStart = Date.now();
  let windowStart = budgetStart;
  let windowCount = 0;
  return (event: ErrorEvent): boolean => {
    const now = Date.now();
    if (now - budgetStart >= resetAfterMs) {
      seen.clear();
      budgetStart = now;
    }
    const signature = JSON.stringify([event.exception, event.tags]);
    if (seen.size >= 20 || seen.has(signature)) return false;
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
