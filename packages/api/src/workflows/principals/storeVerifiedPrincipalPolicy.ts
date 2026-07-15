import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../access/write/principalMemberEnvelopes";
import {
  type PrincipalStateBundleInput,
  type StoredPrincipalState,
  type StoreVerifiedPrincipalStateOptions,
  storeVerifiedPrincipalStateInTransaction,
} from "../../access/write/principalStateStore";

/**
 * Persists every artifact committed by one signed principal-policy state.
 * Callers own the surrounding transaction and must not publish the new head
 * unless this complete operation succeeds.
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

  return state;
}
