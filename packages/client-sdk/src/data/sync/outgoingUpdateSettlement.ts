/**
 * Decide whether a sync lane should re-arm itself on the success path after
 * sending outgoing updates and observing how many the server settled.
 *
 * Re-arm only when the pass settled at least one update — i.e. it made real
 * progress — and updates still remain unsettled. Each settled id is removed
 * from a finite pending pool, so a progress-gated re-arm strictly shrinks that
 * pool and is guaranteed to terminate.
 *
 * A server that under-settles (accepts fewer ids than were sent, settling none
 * of them) must not drive an unbounded success-path re-arm: the lane goes idle
 * and a later mutation / sync signal retries the still-pending work. Without
 * this guard the lane busy-loops at one pass per macrotask forever while still
 * reporting `completed`, and the coordinator never reaches idle.
 */
export function shouldReArmAfterOutgoingSettlement(input: {
  readonly outgoingUpdateCount: number;
  readonly settledUpdateCount: number;
}): boolean {
  return (
    input.settledUpdateCount > 0 &&
    input.outgoingUpdateCount > input.settledUpdateCount
  );
}
