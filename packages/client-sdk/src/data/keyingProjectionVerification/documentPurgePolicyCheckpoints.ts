import {
  KeyingVerificationError,
  principalPolicyMatchesReference,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import {
  loadStoredPrincipalPolicyCheckpoint,
  upsertPrincipalPolicyCheckpointInTransaction,
} from "../persistence/keyingCheckpointPersistence";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";

/** After complete terminal-proof currency validation, admit only its bound sources. */
export async function admitDocumentPurgePolicyCheckpoints(input: {
  readonly transaction: ClientSQLiteTransactionScope;
  readonly organizationId: string | undefined;
  readonly policies: readonly VerifiedPrincipalPolicySelection[];
  readonly heads: readonly ReferencedPrincipalHead[];
}): Promise<void> {
  const updatedAt = new Date().toISOString();
  for (const reference of input.heads) {
    if (
      !input.policies.some((policy) =>
        principalPolicyMatchesReference({ policy, reference }),
      )
    )
      throw new KeyingVerificationError(
        "missing_dependency",
        "Purge source lacks verified inclusion",
      );
    const checkpoint = await loadStoredPrincipalPolicyCheckpoint(
      input.transaction,
      reference,
    );
    // A newer privately authenticated prefix can prove ancestry, but is not an
    // observation admitted by this terminal proof. Preserve any newer pin.
    if (checkpoint && checkpoint.version >= reference.version) continue;
    await upsertPrincipalPolicyCheckpointInTransaction(
      input.transaction,
      reference,
      updatedAt,
      input.organizationId,
    );
  }
}
