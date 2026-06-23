/**
 * Shared convergence-safety predicate for sync lanes that snapshot an enqueue
 * sequence before an async window and decide afterwards whether the signal they
 * consumed may be cleared. The sequence is unchanged only when no fresh remote
 * event advanced it mid-pass; a moved sequence means the consumed signal must
 * survive for the coalesced re-run.
 */
export const sequenceUnchanged = (current: number, consumed: number): boolean =>
  current === consumed;
