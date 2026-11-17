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
import { getVerifiedPrincipalHistory } from "./getVerifiedPrincipalHistory";
import { withPrincipalHistorySuccessorStep } from "./principalHistoryExecution";
import { assertPrincipalIdentityBundles } from "./principalIdentityBundles";
import { storeVerifiedPrincipalDirectoryBindings } from "./storeVerifiedPrincipalDirectoryBindings";

async function verifyStrictAdminsAuthority(
  tx: DatabaseTransaction,
  state: StoredPrincipalState,
): Promise<void> {
  // Only the history is verified; the current artifacts are not read.
  await getVerifiedPrincipalHistory(tx, state, [], "authority");
}

/**
 * Persist all artifacts, verify the stored state against authenticated history,
 * and bind current payload/envelopes before the caller can commit. Progress is
 * buffered until the outer transaction commits, then published by autocommit.
 * Rolled-back or unmanaged transactions never publish new hints. Restored
 * prefixes still recheck their final row.
 *
 * A reserved Admins state is also verified as a strict Admins authority, the
 * check every principal it governs repeats, so that progress publishes with
 * the policy progress instead of a later governed write yielding a 202 to
 * prepare it. As with policy, the committed predecessor is verified first, so
 * a missing prefix prepares that committed head, and the stored head then
 * uses its one-entry successor allowance.
 */
export async function storeVerifiedPrincipalPolicyInTransaction(
  input: PrincipalStateBundleInput,
  tx: DatabaseTransaction,
  options: StoreVerifiedPrincipalStateOptions & {
    readonly identityTrustDomain: string;
    /** The state is its organization's reserved Admins group. */
    readonly reservedAdmins?: boolean;
  },
): Promise<StoredPrincipalState> {
  await assertPrincipalIdentityBundles({
    ...input,
    executor: tx,
    identityTrustDomain: options.identityTrustDomain,
  });
  const previous = await getCurrentPrincipalState(
    input.state.principalType,
    input.state.principalId,
    tx,
  );
  if (previous) {
    await getVerifiedPrincipalPolicyForStateWithExecutor(tx, previous);
    if (options.reservedAdmins === true)
      await verifyStrictAdminsAuthority(tx, previous);
  }
  const stored = await storeVerifiedPrincipalStateInTransaction(
    input,
    tx,
    options,
  );
  const { state } = stored;
  await replaceCurrentPrincipalMemberEnvelopesInTransaction(
    {
      principalType: state.principalType,
      principalId: state.principalId,
      stateHash: state.stateHash,
      envelopes: input.memberEnvelopes,
    },
    tx,
    stored,
  );
  await withPrincipalHistorySuccessorStep(state, async () => {
    await verifyStoredPrincipalPolicyForStateWithExecutor(tx, state);
    if (options.reservedAdmins === true)
      await verifyStrictAdminsAuthority(tx, state);
  });

  await storeVerifiedPrincipalDirectoryBindings({
    executor: tx,
    state,
    ciphertext: input.encryptedPayload.ciphertext,
  });
  return state;
}
