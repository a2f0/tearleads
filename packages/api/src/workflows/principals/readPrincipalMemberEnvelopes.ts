import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import type { PrincipalMemberEnvelopesQuery } from "@tearleads/validators/operation";
import type { CurrentPrincipalMemberEnvelopesResponse } from "@tearleads/validators/response";
import { listPrincipalMemberEnvelopesForState } from "../../access/read/principalMemberEnvelopes";
import {
  getCurrentPrincipalState,
  getPrincipalStatesForReferences,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import { runPrincipalHistoryTransaction } from "./principalHistoryTransaction";
import { assertPrincipalPolicyReadable } from "./principalPolicyReadAuthorization";
import {
  PrincipalPolicyError,
  toCurrentPrincipalMemberEnvelopesResponse,
} from "./shared";

/**
 * Every member envelope of one named, immutable state of a principal, for a
 * client checking a historical member's committed key fingerprint against that
 * state's `memberEnvelopesRoot`. Readers are exactly the policy read's, judged
 * against the live state before the named state's existence is revealed.
 */
export async function runReadPrincipalMemberEnvelopesWorkflow(
  db: ApiDatabase,
  input: PrincipalMemberEnvelopesQuery & {
    readonly principalId: string;
    readonly principalType: ManagedRecipientPrincipalType;
    readonly requesterUserId: string;
  },
): Promise<CurrentPrincipalMemberEnvelopesResponse> {
  const { principalId, principalType, stateHash } = input;
  return runPrincipalHistoryTransaction(db, async (tx) => {
    const currentState = await getCurrentPrincipalState(
      principalType,
      principalId,
      tx,
    );
    if (!currentState) {
      throw new PrincipalPolicyError("Principal policy access denied", 403);
    }
    await assertPrincipalPolicyReadable({
      currentState,
      executor: tx,
      requesterUserId: input.requesterUserId,
    });
    // Exactly as the policy read: authorization reads the live projection,
    // which must verify against the signed live state, or a forged projection
    // could authorize a stranger.
    await getVerifiedPrincipalPolicyForStateWithExecutor(tx, currentState);
    const reference = { principalType, principalId, stateHash };
    const named =
      stateHash === currentState.stateHash
        ? currentState
        : (await getPrincipalStatesForReferences([reference], tx)).get(
            principalStateReferenceKey(reference),
          );
    if (!named) {
      throw new PrincipalPolicyError("Principal state not found", 404);
    }
    return toCurrentPrincipalMemberEnvelopesResponse({
      principalType,
      principalId,
      stateHash,
      epoch: named.keyEpoch,
      envelopes: await listPrincipalMemberEnvelopesForState(
        principalType,
        principalId,
        stateHash,
        tx,
      ),
    });
  });
}
