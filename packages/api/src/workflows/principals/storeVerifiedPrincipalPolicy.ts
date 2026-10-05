import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../access/write/principalMemberEnvelopes";
import {
  type PrincipalStateBundleInput,
  type StoredPrincipalState,
  type StoreVerifiedPrincipalStateOptions,
  storeVerifiedPrincipalStateInTransaction,
} from "../../access/write/principalStateStore";
import { verifyStoredPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";

/**
 * Persist all artifacts, verify the stored state against authenticated history,
 * and bind current payload/envelopes before the caller can commit. Progress is
 * buffered until the outer transaction commits, then published by autocommit.
 * Rolled-back or unmanaged transactions never publish new hints. Restored
 * prefixes still recheck their final row.
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
  await verifyStoredPrincipalPolicyForStateWithExecutor(tx, state);

  return state;
}
