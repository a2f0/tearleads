import type { LockManagerLike } from "./crossTabLocks";

// How long a non-owner tab polls for an owner to appear before it unblocks
// routing anyway. Generous enough to cover a same-origin tab winning the
// ownership bid, short enough never to noticeably delay the first request.
const OWNER_OBSERVE_BUDGET_MS = 2_000;
const OWNER_OBSERVE_INTERVAL_MS = 50;

/**
 * Whether some tab currently holds `lockName`. Returns false when the lock
 * manager cannot be queried, so callers post remotely and let the
 * request/timeout path decide rather than acting on a possibly-stale answer.
 */
export async function isOwnerLockHeld(
  locks: LockManagerLike,
  lockName: string,
): Promise<boolean> {
  if (!locks.query) {
    return false;
  }

  let snapshot: unknown;
  try {
    snapshot = await locks.query();
  } catch {
    return false;
  }

  if (typeof snapshot !== "object" || snapshot === null) {
    return false;
  }

  const held = Reflect.get(snapshot, "held");
  if (!Array.isArray(held)) {
    return false;
  }

  return held.some((lock) => Reflect.get(lock, "name") === lockName);
}

/**
 * Poll on a short budget until an owner is observed — either this tab won
 * (`hasOwner`) or another tab holds the owner lock — then settle. A single
 * query is not enough: at cold start no tab owns yet, so the bid losers would
 * never settle. After the budget we settle regardless: by then some tab has
 * almost certainly won, and the worst case is the first request takes the
 * remote path and relies on the response/timeout.
 */
export async function pollForOwner(params: {
  readonly locks: LockManagerLike;
  readonly lockName: string;
  readonly hasOwner: () => boolean;
  readonly settle: () => void;
}): Promise<void> {
  const deadline = OWNER_OBSERVE_BUDGET_MS / OWNER_OBSERVE_INTERVAL_MS;
  for (let attempt = 0; attempt < deadline; attempt += 1) {
    if (
      params.hasOwner() ||
      (await isOwnerLockHeld(params.locks, params.lockName))
    ) {
      params.settle();
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, OWNER_OBSERVE_INTERVAL_MS);
    });
  }

  params.settle();
}
