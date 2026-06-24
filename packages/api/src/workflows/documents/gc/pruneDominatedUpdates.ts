import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  type PruneBaseline,
  type PruneCandidate,
  planDominatedUpdatePrune,
} from "../../../documents/documentUpdatePrune";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

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

  const baselineRows = await db
    .select({
      documentId: documentAuditCheckpoints.documentId,
      sourceVersionVector: documentAuditCheckpoints.sourceVersionVector,
      baselineEpoch: documentContentWriteHeaders.contentKeyEpoch,
    })
    .from(documentAuditCheckpoints)
    .innerJoin(
      documentContentWriteHeaders,
      eq(
        documentContentWriteHeaders.updateId,
        documentAuditCheckpoints.baselineUpdateId,
      ),
    )
    .where(
      input.documentIds && input.documentIds.length > 0
        ? and(
            eq(documentAuditCheckpoints.checkpointKind, "rotate_baseline"),
            inArray(documentAuditCheckpoints.documentId, input.documentIds),
          )
        : eq(documentAuditCheckpoints.checkpointKind, "rotate_baseline"),
    );

  const baselines: PruneBaseline[] = [];
  for (const row of baselineRows) {
    if (row.sourceVersionVector === null) {
      continue;
    }
    baselines.push({
      documentId: row.documentId,
      sourceVersionVector: row.sourceVersionVector,
      baselineEpoch: row.baselineEpoch,
    });
  }
  if (baselines.length === 0) {
    return { prunedUpdateCount: 0, reclaimedBytes: 0, documentsAffected: 0 };
  }

  const documentIds = [
    ...new Set(baselines.map((baseline) => baseline.documentId)),
  ];
  const candidateRows = await db
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
        inArray(documentUpdates.documentId, documentIds),
        ne(documentUpdates.encryptedData, ""),
      ),
    );

  const candidates: PruneCandidate[] = candidateRows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    contentKeyEpoch: row.contentKeyEpoch,
    byteLength: row.byteLength,
    partialEndVersionVector: row.partialEndVersionVector,
  }));

  const plan = planDominatedUpdatePrune({ baselines, candidates, limit });

  if (plan.updateIds.length > 0) {
    await db
      .update(documentUpdates)
      .set({ encryptedData: "" })
      .where(inArray(documentUpdates.id, plan.updateIds));
  }

  return {
    prunedUpdateCount: plan.updateIds.length,
    reclaimedBytes: plan.reclaimedBytes,
    documentsAffected: plan.documentIds.length,
  };
}
