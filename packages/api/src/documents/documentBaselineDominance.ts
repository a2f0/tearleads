import { satisfiesVersionVector } from "@tearleads/loro";

/**
 * The safety gate for omitting an encrypted document update from sync.
 *
 * A baseline can carry an update forward only when it was written under a
 * strictly newer content-key epoch and its source frontier covers the update's
 * end frontier. Callers must authenticate the baseline and bind it to the same
 * document before reaching this pure protocol-kernel predicate.
 */
export function isDocumentUpdateDominatedByBaseline(input: {
  readonly baselineEpoch: number;
  readonly baselineVersionVector: string;
  readonly updateEpoch: number;
  readonly updateVersionVector: string;
}): boolean {
  return (
    input.updateEpoch < input.baselineEpoch &&
    satisfiesVersionVector(
      input.baselineVersionVector,
      input.updateVersionVector,
    )
  );
}
