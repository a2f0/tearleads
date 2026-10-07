import {
  type ReferencedPrincipalHead,
  selectPrincipalPolicyCurrentPredecessorReferences,
  type VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";

/** Select only this path's old citations, preserving the authored membership. */
export async function resolveCurrentGroupMutationReferences(input: {
  readonly current: VerifiedPrincipalPolicyCurrent;
  readonly predecessor: VerifiedPrincipalPolicyCurrent;
  readonly references: readonly ReferencedPrincipalHead[];
  readonly readPredecessorReference: (
    reference: ReferencedPrincipalHead,
  ) => Promise<VerifiedPrincipalPolicyCurrent>;
  readonly stillCurrent: () => boolean;
}): Promise<VerifiedPrincipalPolicyCurrent> {
  assertProjectionVerificationCurrent(input.stillCurrent);
  const references = structuredClone(input.references);
  const select = (
    current: VerifiedPrincipalPolicyCurrent,
    predecessor: VerifiedPrincipalPolicyCurrent,
    selected: readonly ReferencedPrincipalHead[],
  ) =>
    selectPrincipalPolicyCurrentPredecessorReferences({
      current,
      predecessor,
      references: selected,
    });
  // Normalize and bound the entire request before any per-reference I/O.
  const initial = select(input.current, input.predecessor, references);
  if (initial.ok) return initial.value;
  if (initial.error.code !== "missing_dependency") throw initial.error;
  let current = input.current;
  const selected: ReferencedPrincipalHead[] = [];
  for (const reference of references) {
    assertProjectionVerificationCurrent(input.stillCurrent);
    selected.push(reference);
    let result = select(current, input.predecessor, selected);
    if (!result.ok && result.error.code === "missing_dependency") {
      const predecessor = await input.readPredecessorReference(reference);
      assertProjectionVerificationCurrent(input.stillCurrent);
      result = select(current, predecessor, selected);
    }
    if (!result.ok) throw result.error;
    current = result.value;
  }
  return current;
}
