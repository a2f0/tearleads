/**
 * Decide whether a sync lane should re-arm itself on the success path after
 * sending outgoing updates and observing how many the server settled.
 *
 * Re-arm when the pass settled at least one update — i.e. it made real
 * progress — and updates still remain unsettled. Each settled id is removed
 * from a finite pending pool, so a progress-gated re-arm strictly shrinks that
 * pool and is guaranteed to terminate.
 *
 * An accepted synthetic recovery baseline is also durable progress even
 * though its id has no pending-queue row to settle. Re-arm when it left queued
 * updates so a large baseline cannot strand the ordinary edits it displaced
 * from the bounded request. Merely sending a baseline is not progress: a
 * server that under-settles it must hit the same no-spin guard as other writes.
 *
 * Also re-arm when the pass re-keyed conflicted pending updates: the fresh
 * ids exist precisely so the next pass can submit them, and without a re-arm
 * they wait for an unrelated edit or remote event. For an honest server this
 * terminates on its own (it can conflict on a given id at most once — a
 * re-keyed id is one it has never been shown), but honesty is not assumed:
 * a buggy or malicious server that keeps 409ing fresh ids — or a proxy
 * replaying cached conflict bodies — would otherwise drive a network-speed
 * re-key loop on a lane that keeps reporting `completed`, so the failed-lane
 * backoff never engages. The lane's consecutive rekey-only pass counter
 * bounds that: once it reaches the cap the lane stops self-arming and the
 * still-pending work waits for the next external signal (edit, remote event,
 * lane restart).
 *
 * A server that under-settles without conflicting (accepts fewer ids than
 * were sent, settling and re-keying none) must not drive an unbounded
 * success-path re-arm: the lane goes idle and a later mutation / sync signal
 * retries the still-pending work. Without this guard the lane busy-loops at
 * one pass per macrotask forever while still reporting `completed`, and the
 * coordinator never reaches idle.
 */

export const MAX_CONSECUTIVE_REKEY_ONLY_PASSES = 3;

interface OutgoingSettlementLane {
  rekeyOnlyPassCount?: number | undefined;
}

interface OutgoingSettlementPass {
  readonly outgoingUpdateCount: number;
  readonly rekeyedUpdateCount: number;
  readonly settledUpdateCount: number;
  readonly acceptedRecoveryBaseline?: boolean | undefined;
}

function isRekeyOnlyPass(pass: OutgoingSettlementPass): boolean {
  return pass.rekeyedUpdateCount > 0 && pass.settledUpdateCount === 0;
}

/**
 * Record a completed pass's settlement outcome on the lane and decide whether
 * the lane should immediately re-arm. Settling anything (or not re-keying at
 * all) proves the loop is not rekey-driven and resets the lane's consecutive
 * rekey-only counter.
 */
export function settleOutgoingPassAndDecideReArm(
  lane: OutgoingSettlementLane,
  pass: OutgoingSettlementPass,
): boolean {
  const rekeyOnlyPassCount = lane.rekeyOnlyPassCount ?? 0;
  lane.rekeyOnlyPassCount = isRekeyOnlyPass(pass) ? rekeyOnlyPassCount + 1 : 0;

  return (
    (isRekeyOnlyPass(pass) &&
      rekeyOnlyPassCount < MAX_CONSECUTIVE_REKEY_ONLY_PASSES) ||
    (pass.acceptedRecoveryBaseline === true &&
      pass.outgoingUpdateCount > pass.settledUpdateCount) ||
    (pass.settledUpdateCount > 0 &&
      pass.outgoingUpdateCount > pass.settledUpdateCount)
  );
}
