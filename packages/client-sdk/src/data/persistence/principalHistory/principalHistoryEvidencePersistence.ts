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
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  principalHistoryEntries,
  principalHistoryEvidenceTables,
  principalHistoryNodes,
} from "../../sqlite/schema/principalHistoryEvidenceSchema";
import {
  sqliteInsertBatchSize,
  sqliteRowsPerStatement,
} from "../../sqlite/sqliteBindBudget";
import {
  type ClientSQLiteDatabase,
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../../sqlite/sqliteUpsert";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { writePrincipalHistoryNodes } from "./principalHistoryNodeRetention";
import type { PrincipalHistoryRootEdges } from "./principalHistoryRootOwnership";

const ENTRY_WRITE_BATCH_SIZE = sqliteInsertBatchSize(principalHistoryEntries);

export interface PrincipalHistoryEvidencePage {
  readonly indexRootHash: string;
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
  readonly indexRootHash: string;
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
  rootEdges?: PrincipalHistoryRootEdges | undefined,
): Promise<void> {
  const scope = { scopeId: page.scopeId, organizationId: page.organizationId };
  // A repeated leaf keeps its last entry, as sequential upserts would.
  const entries = new Map(
    page.entries.map((entry) => [
      entry.leafHash,
      { ...scope, leafHash: entry.leafHash, entryJson: entry.entryJson },
    ]),
  );
  const rows = [...entries.values()].sort((a, b) =>
    compareCanonicalStrings(a.leafHash, b.leafHash),
  );
  for (let index = 0; index < rows.length; index += ENTRY_WRITE_BATCH_SIZE)
    await tx
      .insert(principalHistoryEntries)
      .values(rows.slice(index, index + ENTRY_WRITE_BATCH_SIZE))
      .onConflictDoUpdate({
        target: [
          principalHistoryEntries.scopeId,
          principalHistoryEntries.leafHash,
        ],
        set: {
          organizationId: excludedValue(principalHistoryEntries.organizationId),
          entryJson: excludedValue(principalHistoryEntries.entryJson),
        },
      })
      .run();
  await writePrincipalHistoryNodes(
    tx,
    scope,
    [...page.nodes].sort((a, b) => compareCanonicalStrings(a.hash, b.hash)),
    rootEdges,
  );
}

type ResolvedPrincipalHistoryProof = Awaited<
  ReturnType<typeof resolvePrincipalHistoryIndexProof>
>;

// The scope id binds once per lookup.
const HASH_LOOKUP_BATCH_SIZE = sqliteRowsPerStatement(1, 1);

/** Thrown by the preloaded node reader to ask the next level's set read for a hash. */
class PrincipalHistoryNodeNotLoaded {
  constructor(readonly hash: string) {}
}

function hashBatches(hashes: readonly string[]): string[][] {
  const result: string[][] = [];
  for (let index = 0; index < hashes.length; index += HASH_LOOKUP_BATCH_SIZE)
    result.push(hashes.slice(index, index + HASH_LOOKUP_BATCH_SIZE));
  return result;
}

/**
 * Reads `hashes` into `into`, absent ones as null. Only stored nodes are proof
 * material; a liveness placeholder without child hashes reads as absent.
 */
async function loadStoredPrincipalHistoryNodes(
  db: ClientSQLiteDatabase,
  scopeId: string,
  hashes: ReadonlySet<string>,
  into: Map<string, PrincipalHistoryIndexNode | null>,
): Promise<void> {
  for (const batch of hashBatches([...hashes])) {
    for (const hash of batch) into.set(hash, null);
    const rows = await db
      .select({
        hash: principalHistoryNodes.hash,
        leftHash: principalHistoryNodes.leftHash,
        rightHash: principalHistoryNodes.rightHash,
      })
      .from(principalHistoryNodes)
      .where(
        and(
          eq(principalHistoryNodes.scopeId, scopeId),
          inArray(principalHistoryNodes.hash, batch),
          isNotNull(principalHistoryNodes.leftHash),
          isNotNull(principalHistoryNodes.rightHash),
        ),
      );
    for (const { hash, leftHash, rightHash } of rows)
      if (leftHash !== null && rightHash !== null)
        into.set(hash, { hash, leftHash, rightHash });
  }
}

/**
 * Resolves every version's index path level by level: each pass walks every
 * unfinished version over the nodes read so far, and one set read per level
 * supplies the nodes the walks stopped at. A node absent after its read stays
 * missing, so the unchanged verifier fails that version as it would serially.
 */
async function resolvePrincipalHistoryProofs(
  db: ClientSQLiteDatabase,
  input: {
    readonly scopeId: string;
    readonly history: VerifiedPrincipalPolicyHistory;
    readonly versions: readonly number[];
  },
): Promise<({ value: ResolvedPrincipalHistoryProof } | { error: unknown })[]> {
  const nodes = new Map<string, PrincipalHistoryIndexNode | null>();
  const results: (
    | { value: ResolvedPrincipalHistoryProof }
    | { error: unknown }
  )[] = [];
  let pending = input.versions.map((_, index) => index);
  while (pending.length > 0) {
    const needed = new Set<string>();
    const unfinished: number[] = [];
    for (const index of pending) {
      try {
        results[index] = {
          value: await resolvePrincipalHistoryIndexProof({
            rootHash: input.history.indexRootHash,
            treeSize: input.history.currentEntry.state.version,
            version: input.versions[index] ?? 0,
            readNode: async (hash) => {
              const node = nodes.get(hash);
              if (node === undefined)
                throw new PrincipalHistoryNodeNotLoaded(hash);
              return node;
            },
          }),
        };
      } catch (error) {
        if (!(error instanceof PrincipalHistoryNodeNotLoaded)) {
          results[index] = { error };
          continue;
        }
        needed.add(error.hash);
        unfinished.push(index);
      }
    }
    await loadStoredPrincipalHistoryNodes(db, input.scopeId, needed, nodes);
    pending = unfinished;
  }
  return results;
}

async function loadPrincipalHistoryEntryJson(
  db: ClientSQLiteDatabase,
  scopeId: string,
  leafHashes: readonly string[],
): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  for (const batch of hashBatches([...new Set(leafHashes)])) {
    const rows = await db
      .select({
        leafHash: principalHistoryEntries.leafHash,
        entryJson: principalHistoryEntries.entryJson,
      })
      .from(principalHistoryEntries)
      .where(
        and(
          eq(principalHistoryEntries.scopeId, scopeId),
          inArray(principalHistoryEntries.leafHash, batch),
        ),
      );
    for (const row of rows) entries.set(row.leafHash, row.entryJson);
  }
  return entries;
}

function parsePrincipalHistoryEntry(
  entryJson: string | undefined,
): PrincipalPolicyStateChainEntryResponse {
  let entry: unknown;
  try {
    entry = entryJson === undefined ? null : JSON.parse(entryJson);
  } catch {
    entry = null;
  }
  if (!isPrincipalPolicyStateChainEntryResponse(entry))
    throw new KeyingVerificationError(
      "missing_dependency",
      "Principal history entry is missing or corrupt",
    );
  return entry;
}

/**
 * Returns untrusted material, in `versions` order. The caller must verify it
 * against the issued root. Index nodes are read one level at a time for every
 * version and entries in one set read; the first version that fails, in
 * order, throws the error loading it alone would.
 */
export async function loadPrincipalHistoryReferences(input: {
  readonly execSql: ExecSql;
  readonly scopeId: string;
  readonly history: VerifiedPrincipalPolicyHistory;
  readonly versions: readonly number[];
}): Promise<PrincipalPolicyHistoryReferenceProof[]> {
  await ensureSqlTables(input.execSql, principalHistoryEvidenceTables);
  const { db } = getClientSQLitePersistenceRuntime(input.execSql);
  const resolved = await resolvePrincipalHistoryProofs(db, input);
  const entries = await loadPrincipalHistoryEntryJson(
    db,
    input.scopeId,
    resolved.flatMap((result) =>
      "value" in result ? [result.value.leafHash] : [],
    ),
  );
  return resolved.map((result) => {
    if (!("value" in result)) throw result.error;
    const entry = parsePrincipalHistoryEntry(
      entries.get(result.value.leafHash),
    );
    return {
      reference: {
        principalType: entry.state.principalType,
        principalId: entry.state.principalId,
        version: entry.state.version,
        keyEpoch: entry.state.keyEpoch,
        stateHash: entry.state.stateHash,
        keyFingerprint: entry.state.keyFingerprint,
      },
      entry,
      proof: result.value.proof,
    };
  });
}

/** Returns untrusted material. The caller must verify it against the issued root. */
export async function loadPrincipalHistoryReference(input: {
  readonly execSql: ExecSql;
  readonly scopeId: string;
  readonly history: VerifiedPrincipalPolicyHistory;
  readonly version: number;
  readonly expectedReference?: ReferencedPrincipalHead | undefined;
}): Promise<PrincipalPolicyHistoryReferenceProof> {
  const [loaded] = await loadPrincipalHistoryReferences({
    ...input,
    versions: [input.version],
  });
  if (!loaded) throw new Error("Principal history reference was not loaded");
  return input.expectedReference
    ? { ...loaded, reference: input.expectedReference }
    : loaded;
}
