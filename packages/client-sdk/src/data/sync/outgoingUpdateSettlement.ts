/**
 * Decide whether a sync lane should re-arm itself on the success path after
 * sending outgoing updates and observing how many the server settled.
 *
 * Re-arm when the pass settled at least one update — i.e. it made real
 * progress — and updates still remain unsettled. Each settled id is removed
 * from a finite pending pool, so a progress-gated re-arm strictly shrinks that
 * pool and is guaranteed to terminate.
 *
 * Also re-arm when the pass re-keyed conflicted pending updates: the fresh
 * ids exist precisely so the next pass can submit them, and without a re-arm
 * they wait for an unrelated edit or remote event. This stays bounded for an
 * honest server, which can conflict on a given id at most once — a re-keyed
 * id is one the server has never been shown, so a repeat conflict requires a
 * genuine new lost ack (each of which also commits the ops server-side).
 *
 * A server that under-settles without conflicting (accepts fewer ids than
 * were sent, settling and re-keying none) must not drive an unbounded
 * success-path re-arm: the lane goes idle and a later mutation / sync signal
 * retries the still-pending work. Without this guard the lane busy-loops at
 * one pass per macrotask forever while still reporting `completed`, and the
 * coordinator never reaches idle.
 */
export function shouldReArmAfterOutgoingSettlement(input: {
  readonly outgoingUpdateCount: number;
  readonly rekeyedUpdateCount: number;
  readonly settledUpdateCount: number;
}): boolean {
  return (
    input.rekeyedUpdateCount > 0 ||
    (input.settledUpdateCount > 0 &&
      input.outgoingUpdateCount > input.settledUpdateCount)
  );
}
