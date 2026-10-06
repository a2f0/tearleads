import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../access/write/principalMemberEnvelopes";
import {
  type PrincipalStateBundleInput,
  type StoredPrincipalState,
  type StoreVerifiedPrincipalStateOptions,
  storeVerifiedPrincipalStateInTransaction,
} from "../../access/write/principalStateStore";
import {
  getVerifiedPrincipalPolicyForStateWithExecutor,
  verifyStoredPrincipalPolicyForStateWithExecutor,
} from "./getCurrentPrincipalPolicy";
import { withPrincipalHistorySuccessorStep } from "./principalHistoryExecution";

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
  const previous = await getCurrentPrincipalState(
    input.state.principalType,
    input.state.principalId,
    tx,
  );
  if (previous)
    await getVerifiedPrincipalPolicyForStateWithExecutor(tx, previous);
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
  await withPrincipalHistorySuccessorStep(state, () =>
    verifyStoredPrincipalPolicyForStateWithExecutor(tx, state),
  );

  return state;
}
