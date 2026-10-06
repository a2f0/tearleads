import {
  compareCanonicalStrings,
  KeyingVerificationError,
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type PrincipalHistoryIndexNode,
  type PrincipalPolicyHistoryReferenceProof,
  principalHistoryIndexLeaf,
  type ReferencedPrincipalHead,
  resolvePrincipalHistoryIndexProof,
  type VerifiedPrincipalPolicyHistory,
} from "@tearleads/crypto";
import {
  isPrincipalPolicyStateChainEntryResponse,
  type PrincipalPolicyStateChainEntryResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  principalHistoryEntries,
  principalHistoryEvidenceTables,
  principalHistoryNodes,
} from "../sqlite/principalHistoryEvidenceSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

export interface PrincipalHistoryEvidencePage {
  readonly scopeId: string;
  readonly organizationId: string;
  readonly entries: readonly {
    readonly leafHash: string;
    readonly entryJson: string;
  }[];
  readonly nodes: readonly PrincipalHistoryIndexNode[];
}

/** Prepare only a page accepted by the signature/authorization verifier. */
export async function preparePrincipalHistoryEvidencePage(input: {
  readonly scopeId: string;
  readonly organizationId: string;
  readonly entries: readonly PrincipalPolicyStateChainEntryResponse[];
  readonly nodes: readonly PrincipalHistoryIndexNode[];
}): Promise<PrincipalHistoryEvidencePage> {
  if (
    input.entries.length > PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT ||
    input.nodes.length > 2 * PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Principal evidence page exceeds its batch budget",
    );
  const owned = structuredClone(input);
  return {
    ...owned,
    entries: await Promise.all(
      owned.entries.map(async (entry) => ({
        leafHash: await principalHistoryIndexLeaf(entry.state),
        entryJson: JSON.stringify(entry),
      })),
    ),
  };
}

/** Publish in the same guarded transaction as the accepted page's progress. */
export async function writePrincipalHistoryEvidencePage(
  tx: ClientSQLiteTransactionScope,
  page: PrincipalHistoryEvidencePage,
): Promise<void> {
  const scope = { scopeId: page.scopeId, organizationId: page.organizationId };
  for (const entry of [...page.entries].sort((a, b) =>
    compareCanonicalStrings(a.leafHash, b.leafHash),
  )) {
    const row = { ...scope, ...entry };
    await tx
      .insert(principalHistoryEntries)
      .values(row)
      .onConflictDoUpdate({
        target: [
          principalHistoryEntries.scopeId,
          principalHistoryEntries.leafHash,
        ],
        set: row,
      })
      .run();
  }
  for (const node of [...page.nodes].sort((a, b) =>
    compareCanonicalStrings(a.hash, b.hash),
  )) {
    const row = { ...scope, ...node };
    await tx
      .insert(principalHistoryNodes)
      .values(row)
      .onConflictDoUpdate({
        target: [principalHistoryNodes.scopeId, principalHistoryNodes.hash],
        set: row,
      })
      .run();
  }
}

/** Returns untrusted material. The caller must verify it against the issued root. */
export async function loadPrincipalHistoryReference(input: {
  readonly execSql: ExecSql;
  readonly scopeId: string;
  readonly history: VerifiedPrincipalPolicyHistory;
  readonly version: number;
  readonly expectedReference?: ReferencedPrincipalHead | undefined;
}): Promise<PrincipalPolicyHistoryReferenceProof> {
  await ensureSqlTables(input.execSql, principalHistoryEvidenceTables);
  const { db } = getClientSQLitePersistenceRuntime(input.execSql);
  const resolved = await resolvePrincipalHistoryIndexProof({
    rootHash: input.history.indexRootHash,
    treeSize: input.history.currentEntry.state.version,
    version: input.version,
    readNode: async (hash) => {
      const [row] = await db
        .select()
        .from(principalHistoryNodes)
        .where(
          and(
            eq(principalHistoryNodes.scopeId, input.scopeId),
            eq(principalHistoryNodes.hash, hash),
          ),
        )
        .limit(1);
      return row ?? null;
    },
  });
  const [row] = await db
    .select()
    .from(principalHistoryEntries)
    .where(
      and(
        eq(principalHistoryEntries.scopeId, input.scopeId),
        eq(principalHistoryEntries.leafHash, resolved.leafHash),
      ),
    )
    .limit(1);
  let entry: unknown;
  try {
    entry = row ? JSON.parse(row.entryJson) : null;
  } catch {
    entry = null;
  }
  if (!isPrincipalPolicyStateChainEntryResponse(entry))
    throw new KeyingVerificationError(
      "missing_dependency",
      "Principal history entry is missing or corrupt",
    );
  const reference = input.expectedReference ?? {
    principalType: entry.state.principalType,
    principalId: entry.state.principalId,
    version: entry.state.version,
    keyEpoch: entry.state.keyEpoch,
    stateHash: entry.state.stateHash,
    keyFingerprint: entry.state.keyFingerprint,
  };
  return { reference, entry, proof: resolved.proof };
}
