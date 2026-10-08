import { computePrincipalMemberEnvelopesRoot } from "@tearleads/crypto";
import { isPrincipalPolicyPageResponse } from "@tearleads/validators/response";
import { lte } from "drizzle-orm";
import { principalKeyEnvelopeArchive } from "../sqlite/principalHistoryRetentionSchema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";

/**
 * Preserve untrusted encrypted candidates, never history or authorization.
 * The caller replaces progress in this same transaction. Public-history hints
 * carry no private artifacts and deliberately contribute no candidates.
 */
export async function archivePrincipalHistoryKeyEnvelopes(
  tx: ClientSQLiteTransactionScope,
  input: {
    readonly organizationId: string;
    readonly currentJson: string;
    readonly version: number;
  },
) {
  let current: unknown;
  try {
    current = JSON.parse(input.currentJson);
  } catch {
    return;
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return;
  const page = {
    ...current,
    previousStates: [],
    historyPage: { afterVersion: input.version - 1, nextAfterVersion: null },
  };
  if (
    !isPrincipalPolicyPageResponse(page) ||
    page.currentState.version !== input.version ||
    page.currentState.stateHash !== page.currentMemberEnvelopes.stateHash ||
    page.currentState.principalId !== page.currentMemberEnvelopes.principalId ||
    page.currentState.principalType !==
      page.currentMemberEnvelopes.principalType ||
    page.currentState.keyEpoch !== page.currentMemberEnvelopes.epoch
  )
    return;
  try {
    if (
      (await computePrincipalMemberEnvelopesRoot(
        page.currentMemberEnvelopes.envelopes,
      )) !== page.currentState.memberEnvelopesRoot
    )
      return;
  } catch {
    return;
  }
  const row = {
    organizationId: input.organizationId,
    principalId: page.currentState.principalId,
    principalType: page.currentState.principalType,
    keyFingerprint: page.currentState.keyFingerprint,
    version: input.version,
    envelopesJson: JSON.stringify(page.currentMemberEnvelopes),
  };
  await tx
    .insert(principalKeyEnvelopeArchive)
    .values(row)
    .onConflictDoUpdate({
      target: [
        principalKeyEnvelopeArchive.organizationId,
        principalKeyEnvelopeArchive.principalType,
        principalKeyEnvelopeArchive.principalId,
        principalKeyEnvelopeArchive.keyFingerprint,
      ],
      set: row,
      setWhere: lte(principalKeyEnvelopeArchive.version, row.version),
    })
    .run();
}
