import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { isAuthenticatedReplayableBaseline } from "../../../documents/documentReplayableBaseline";
import {
  type PruneBaseline,
  type PruneCandidate,
  planDominatedUpdatePrune,
} from "../../../documents/documentUpdatePrune";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const DOCUMENT_CHUNK_SIZE = 100;

export interface PruneDominatedUpdatesInput {
  readonly limit?: number;
  /** Restrict the sweep to these documents (defaults to every document). */
  readonly documentIds?: readonly string[];
}

export interface PruneDominatedUpdatesResult {
  readonly prunedUpdateCount: number;
  readonly reclaimedBytes: number;
  readonly documentsAffected: number;
}

async function loadRotateBaselines(
  db: ApiDatabase,
  documentIds: readonly string[] | undefined,
): Promise<PruneBaseline[]> {
  const scoped = documentIds !== undefined && documentIds.length > 0;
  const rows = await db
    .select({
      checkpointKind: documentAuditCheckpoints.checkpointKind,
      documentId: documentAuditCheckpoints.documentId,
      header: documentContentWriteHeaders.header,
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
      partialStartVersionVector: documentUpdates.partialStartVersionVector,
      plaintextHash: documentUpdates.plaintextHash,
      sourceVersionVector: documentAuditCheckpoints.sourceVersionVector,
      baselineEpoch: documentContentWriteHeaders.contentKeyEpoch,
      updateId: documentAuditCheckpoints.baselineUpdateId,
    })
    .from(documentAuditCheckpoints)
    .innerJoin(
      documentContentWriteHeaders,
      eq(
        documentContentWriteHeaders.updateId,
        documentAuditCheckpoints.baselineUpdateId,
      ),
    )
    .innerJoin(
      documentUpdates,
      eq(documentUpdates.id, documentAuditCheckpoints.baselineUpdateId),
    )
    .where(
      scoped
        ? and(
            eq(documentAuditCheckpoints.checkpointKind, "rotate_baseline"),
            inArray(documentAuditCheckpoints.documentId, documentIds),
          )
        : eq(documentAuditCheckpoints.checkpointKind, "rotate_baseline"),
    );

  const baselines: PruneBaseline[] = [];
  for (const row of rows) {
    if (
      !(await isAuthenticatedReplayableBaseline({
        checkpointKind: row.checkpointKind,
        documentId: row.documentId,
        metadataHash: row.header.metadataHash,
        partialEndVersionVector: row.partialEndVersionVector,
        partialStartVersionVector: row.partialStartVersionVector,
        plaintextHash: row.plaintextHash,
        sourceVersionVector: row.sourceVersionVector,
        updateId: row.updateId,
      }))
    ) {
      continue;
    }
    baselines.push({
      documentId: row.documentId,
      sourceVersionVector: row.sourceVersionVector,
      baselineEpoch: row.baselineEpoch,
    });
  }
  return baselines;
}

async function loadChunkCandidates(
  db: ApiDatabase,
  chunkDocumentIds: readonly string[],
): Promise<PruneCandidate[]> {
  const rows = await db
    .select({
      id: documentUpdates.id,
      documentId: documentUpdates.documentId,
      contentKeyEpoch: documentContentWriteHeaders.contentKeyEpoch,
      byteLength: documentUpdates.byteLength,
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
    })
    .from(documentUpdates)
    .innerJoin(
      documentContentWriteHeaders,
      eq(documentContentWriteHeaders.updateId, documentUpdates.id),
    )
    .where(
      and(
        inArray(documentUpdates.documentId, chunkDocumentIds),
        ne(documentUpdates.encryptedData, ""),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    contentKeyEpoch: row.contentKeyEpoch,
    byteLength: row.byteLength,
    partialEndVersionVector: row.partialEndVersionVector,
  }));
}

/**
 * Clear the encrypted payload of pre-rotation updates that a rotate_baseline
 * dominates (see documentUpdatePrune for the safety rationale). Loads the
 * rotate_baseline coverage and the still-populated updates for those documents,
 * plans the prune, then empties `encrypted_data` for the selected rows in a
 * single statement. Attribution metadata (spans + write headers) is untouched.
 */
export async function runPruneDominatedUpdatesWorkflow(
  db: ApiDatabase,
  input: PruneDominatedUpdatesInput = {},
): Promise<PruneDominatedUpdatesResult> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const baselines = await loadRotateBaselines(db, input.documentIds);
  if (baselines.length === 0) {
    return { prunedUpdateCount: 0, reclaimedBytes: 0, documentsAffected: 0 };
  }

  // Process documents in chunks: a production sweep can span far more documents
  // than PostgreSQL's bind-parameter limit allows in a single inArray, and
  // loading every candidate update at once would blow the heap. Each chunk loads
  // only its own candidates, and we stop once `limit` updates have been planned.
  const documentIds = [
    ...new Set(baselines.map((baseline) => baseline.documentId)),
  ];
  const prunedUpdateIds: string[] = [];
  const affectedDocumentIds = new Set<string>();
  let reclaimedBytes = 0;

  for (
    let start = 0;
    start < documentIds.length && prunedUpdateIds.length < limit;
    start += DOCUMENT_CHUNK_SIZE
  ) {
    const chunkDocumentIds = documentIds.slice(
      start,
      start + DOCUMENT_CHUNK_SIZE,
    );
    const chunkDocumentIdSet = new Set(chunkDocumentIds);
    const candidates = await loadChunkCandidates(db, chunkDocumentIds);
    const chunkBaselines = baselines.filter((baseline) =>
      chunkDocumentIdSet.has(baseline.documentId),
    );

    const plan = planDominatedUpdatePrune({
      baselines: chunkBaselines,
      candidates,
      limit: limit - prunedUpdateIds.length,
    });
    prunedUpdateIds.push(...plan.updateIds);
    reclaimedBytes += plan.reclaimedBytes;
    for (const documentId of plan.documentIds) {
      affectedDocumentIds.add(documentId);
    }
  }

  if (prunedUpdateIds.length > 0) {
    await db
      .update(documentUpdates)
      .set({ encryptedData: "" })
      .where(inArray(documentUpdates.id, prunedUpdateIds));
  }

  return {
    prunedUpdateCount: prunedUpdateIds.length,
    reclaimedBytes,
    documentsAffected: affectedDocumentIds.size,
  };
}
