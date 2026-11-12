import { computePrincipalMemberEnvelopesRoot } from "@tearleads/crypto";
import { isPrincipalPolicyPageResponse } from "@tearleads/validators/response";
import { lte } from "drizzle-orm";
import { principalKeyEnvelopeArchive } from "../../sqlite/schema/principalHistoryRetentionSchema";
import { sqliteInsertBatchSize } from "../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../../sqlite/sqliteUpsert";

interface ArchiveInput {
  readonly organizationId: string;
  readonly currentJson: string;
  readonly version: number;
}

/**
 * Preserve untrusted encrypted candidates, never history or authorization.
 * The caller replaces progress in this same transaction. Public-history hints
 * carry no private artifacts and deliberately contribute no candidates.
 */
export async function archivePrincipalHistoryKeyEnvelopes(
  tx: ClientSQLiteTransactionScope,
  input: ArchiveInput,
) {
  await archivePrincipalHistoryKeyEnvelopeBatch(tx, [input]);
}

async function archiveCandidate(input: ArchiveInput) {
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
  return {
    organizationId: input.organizationId,
    principalId: page.currentState.principalId,
    principalType: page.currentState.principalType,
    keyFingerprint: page.currentState.keyFingerprint,
    version: input.version,
    envelopesJson: JSON.stringify(page.currentMemberEnvelopes),
  };
}

/** Keep input order: newer versions win, and equal versions keep the last candidate. */
export async function archivePrincipalHistoryKeyEnvelopeBatch(
  tx: ClientSQLiteTransactionScope,
  inputs: readonly ArchiveInput[],
) {
  const rows: (typeof principalKeyEnvelopeArchive.$inferInsert)[] = [];
  for (const input of inputs) {
    const row = await archiveCandidate(input);
    if (row) rows.push(row);
  }
  const batchSize = sqliteInsertBatchSize(principalKeyEnvelopeArchive);
  for (let offset = 0; offset < rows.length; offset += batchSize)
    await tx
      .insert(principalKeyEnvelopeArchive)
      .values(rows.slice(offset, offset + batchSize))
      .onConflictDoUpdate({
        target: [
          principalKeyEnvelopeArchive.organizationId,
          principalKeyEnvelopeArchive.principalType,
          principalKeyEnvelopeArchive.principalId,
          principalKeyEnvelopeArchive.keyFingerprint,
        ],
        set: {
          version: excludedValue(principalKeyEnvelopeArchive.version),
          envelopesJson: excludedValue(
            principalKeyEnvelopeArchive.envelopesJson,
          ),
        },
        setWhere: lte(
          principalKeyEnvelopeArchive.version,
          excludedValue(principalKeyEnvelopeArchive.version),
        ),
      })
      .run();
}
