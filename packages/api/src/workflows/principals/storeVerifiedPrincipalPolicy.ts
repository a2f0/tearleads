import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../access/write/principalMemberEnvelopes";
import {
  type PrincipalStateBundleInput,
  type StoredPrincipalState,
  type StoreVerifiedPrincipalStateOptions,
  storeVerifiedPrincipalStateInTransaction,
} from "../../access/write/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";

/**
 * Persists every artifact committed by one signed principal-policy state and
 * then re-verifies the whole stored chain from rows, exactly as a reader will.
 * Callers own the surrounding transaction and must not publish the new head
 * unless this complete operation succeeds: a bundle that verified on submission
 * but not from storage never commits, so no head becomes unreadable.
 */
export async function storeVerifiedPrincipalPolicyInTransaction(
  input: PrincipalStateBundleInput,
  tx: DatabaseTransaction,
  options?: StoreVerifiedPrincipalStateOptions,
): Promise<StoredPrincipalState> {
  const state = await storeVerifiedPrincipalStateInTransaction(
    input,
    tx,
    options,
  );
  await replaceCurrentPrincipalMemberEnvelopesInTransaction(
    {
      principalType: state.principalType,
      principalId: state.principalId,
      stateHash: state.stateHash,
      envelopes: input.memberEnvelopes,
    },
    tx,
  );
  await getVerifiedPrincipalPolicyForStateWithExecutor(tx, state);

  return state;
}
