import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  compareCanonicalStrings,
  computePrincipalStateHash,
} from "@tearleads/crypto";
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
import { buildPrincipalPolicyCurrentForStateWithExecutor } from "./principalPolicyBundleRecords";
import {
  PrincipalPolicyError,
  toCurrentPrincipalMemberEnvelopesResponse,
} from "./shared";

/** Call only after finding an actor-bound receipt for this entire exact request. */
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
  if (
    !state ||
    !canonicalJsonEquals(principalHistoryHead(state), reference) ||
    (await computePrincipalStateHash(state)) !== reference.stateHash
  )
    throw invalid();
  const current = await buildPrincipalPolicyCurrentForStateWithExecutor(
    input.executor,
    state,
  );
  return {
    ...current,
    // Rotation removes the old envelope rows. The authenticated exact request
    // already supplies these bytes; the receipt must never retain another copy.
    currentMemberEnvelopes: toCurrentPrincipalMemberEnvelopesResponse({
      principalType: reference.principalType,
      principalId: reference.principalId,
      stateHash: reference.stateHash,
      epoch: reference.keyEpoch,
      envelopes: [...request.memberEnvelopes].sort((left, right) =>
        compareCanonicalStrings(left.userId, right.userId),
      ),
    }),
    containerMutations: [],
  };
}
