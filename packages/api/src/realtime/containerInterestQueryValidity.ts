/**
 * Whether a running container-interest query may still answer its readers.
 *
 * - `reusable`: later runs for the same tree share it, and its readers install
 *   proofs that no observed change touched.
 * - `stale`: its answer may predate a lost invalidation (a reconnect, a
 *   proof-deadline eviction, a reader's timeout, or a change to a proof's
 *   path). Readers re-query; later runs wait for it and query afresh.
 * - `overflowed`: more changes arrived than it can track, so nobody can tell
 *   which proofs they touched. Readers are refused; later runs wait for it and
 *   query afresh. It outranks `stale`, which it absorbs.
 *
 * | state      | marked-stale | change-observed below cap | change-observed at cap |
 * | ---------- | ------------ | ------------------------- | ---------------------- |
 * | reusable   | stale        | -                         | overflowed             |
 * | stale      | -            | -                         | overflowed             |
 * | overflowed | -            | -                         | -                      |
 *
 * `-` returns the same state.
 */
export type ContainerInterestQueryValidity =
  | "reusable"
  | "stale"
  | "overflowed";

export type ContainerInterestQueryValidityEvent =
  /** The query's answer can no longer be trusted, but readers may retry. */
  | { readonly type: "marked-stale" }
  /** An access change arrived while `pendingChanges` were already tracked. */
  | { readonly type: "change-observed"; readonly pendingChanges: number };

/** The most access changes one running query tracks before it overflows. */
const MAX_PENDING_ACCESS_CHANGES = 10_000;

export function transitionQueryValidity(
  state: ContainerInterestQueryValidity,
  event: ContainerInterestQueryValidityEvent,
): ContainerInterestQueryValidity {
  switch (event.type) {
    case "marked-stale":
      return state === "reusable" ? "stale" : state;
    case "change-observed":
      return event.pendingChanges >= MAX_PENDING_ACCESS_CHANGES
        ? "overflowed"
        : state;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled container interest query event: ${JSON.stringify(value)}`,
  );
}
