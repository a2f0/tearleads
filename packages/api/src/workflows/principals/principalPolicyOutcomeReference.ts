import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { computePrincipalStateHash } from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import {
  isReferencedPrincipalStateResponse,
  type PrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import {
  getPrincipalStatesForReferences,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { principalHistoryHead } from "./principalHistoryRecords";
import { toPrincipalPolicyMutationResponse } from "./principalPolicyAcknowledgement";
import { PrincipalPolicyError } from "./shared";

/**
 * Call only after finding an actor-bound receipt for this entire exact request.
 * The replay acknowledges the stored head the receipt names; its container
 * mutation acknowledgements are left to the caller, which loads the ones the
 * server still holds.
 */
export async function loadPrincipalPolicyOutcomeReference(input: {
  readonly executor: DatabaseTransaction;
  readonly reference: unknown;
  readonly request: PutPrincipalPolicyRequest;
  readonly principalType: "group" | "organization";
  readonly principalId: string;
}): Promise<PrincipalPolicyMutationResponse> {
  const invalid = () =>
    new PrincipalPolicyError(
      "Stored principal policy acknowledgement does not match its request",
      409,
    );
  const { reference, request } = input;
  const expected = principalHistoryHead({
    ...request.state,
    stateHash: await computePrincipalStateHash(request.state),
  });
  if (
    !isReferencedPrincipalStateResponse(reference) ||
    reference.principalType !== input.principalType ||
    reference.principalId !== input.principalId ||
    !canonicalJsonEquals(reference, expected)
  )
    throw invalid();
  const state = (
    await getPrincipalStatesForReferences([reference], input.executor)
  ).get(principalStateReferenceKey(reference));
  // The receipt authenticates the entire original request, including the
  // signature bytes the public state hash omits; the stored state must still
  // carry them before the head is acknowledged again.
  if (
    !state ||
    !canonicalJsonEquals(principalHistoryHead(state), reference) ||
    (await computePrincipalStateHash(state)) !== reference.stateHash ||
    state.signature !== request.state.signature
  )
    throw invalid();
  return toPrincipalPolicyMutationResponse(state, []);
}
