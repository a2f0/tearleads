import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  documentAuditCheckpoints,
  documentContentWriteHeaders,
  documentUpdates,
} from "@symcrypt/api-shared/schema";
import { and, desc, eq, lte } from "drizzle-orm";
import { isDocumentUpdateDominatedByBaseline } from "./documentBaselineDominance";
import { isAuthenticatedReplayableBaseline } from "./documentReplayableBaseline";

/**
 * Coverage-gated baseline redirect for document sync pulls.
 *
 * The frontier diff returns every update a reader is missing, regardless of the
 * content-key epoch it was written under. A reader added after a container-KEK
 * rotation cannot unwrap the pre-rotation epochs, and the client decrypt path is
 * all-or-nothing — one undecryptable update poisons the whole batch, so the
 * reader never converges (see the post-rotation-reader-convergence repro).
 *
 * A rotate_baseline is a full export re-encrypted under the current content key,
 * so it both (a) is readable by every current reader (including newcomers) and
 * (b) carries the state of all pre-rotation updates it dominates. When the
 * missing set spans an older content-key epoch, we therefore redirect the reader
 * to the latest current-epoch baseline and omit the older-epoch updates it
 * covers — but ONLY when the baseline provably dominates every one of them.
 *
 * The gate is what keeps this safe: we never drop an update that is not covered
 * by a served baseline, so a reader can never silently converge to partial
 * state. If there is no current-epoch baseline, or it does not dominate some
 * older-epoch update (e.g. a concurrent pre-rotation write the baseline author
 * had not yet seen), we fall back to serving everything — the same behavior as
 * before, which is safe (no data loss) even if it leaves a newcomer waiting.
 */

interface ServableSyncUpdateEntry {
  readonly update: { readonly partialEndVersionVector: string };
  readonly writeHeader: { readonly contentKeyEpoch: number };
}

/**
 * Decide which missing-update entries to actually serve, given the document's
 * current content-key epoch and the latest current-epoch baseline coverage
 * (`null` when none exists). Pure and order-preserving.
 */
export function selectServedSyncUpdates<
  Entry extends ServableSyncUpdateEntry,
>(input: {
  readonly entries: readonly Entry[];
  readonly currentContentKeyEpoch: number;
  readonly baselineCoverage: string | null;
}): Entry[] {
  const olderEpochEntries = input.entries.filter(
    (entry) => entry.writeHeader.contentKeyEpoch < input.currentContentKeyEpoch,
  );
  // No pre-rotation updates in the missing set: nothing to redirect.
  if (olderEpochEntries.length === 0) {
    return [...input.entries];
  }
  // No readable baseline to carry the older updates forward: serve everything.
  if (input.baselineCoverage === null) {
    return [...input.entries];
  }
  const coverage = input.baselineCoverage;
  const baselineDominatesOlderUpdates = olderEpochEntries.every((entry) =>
    isDocumentUpdateDominatedByBaseline({
      baselineEpoch: input.currentContentKeyEpoch,
      baselineVersionVector: coverage,
      updateEpoch: entry.writeHeader.contentKeyEpoch,
      updateVersionVector: entry.update.partialEndVersionVector,
    }),
  );
  // An older update the baseline does not cover cannot be safely dropped: serve
  // everything rather than risk silent partial convergence.
  if (!baselineDominatesOlderUpdates) {
    return [...input.entries];
  }
  // Safe to redirect: keep the current-epoch updates (incl. the baseline) and
  // drop the older-epoch updates the baseline carries.
  return input.entries.filter(
    (entry) =>
      entry.writeHeader.contentKeyEpoch >= input.currentContentKeyEpoch,
  );
}

/**
 * Load the `sourceVersionVector` of the latest rotate_baseline whose baseline
 * update was written under `contentKeyEpoch` (the reader-readable current
 * epoch). Returns `null` when no such baseline exists.
 */
export async function loadLatestReadableBaselineCoverage(
  executor: DatabaseSession,
  input: {
    readonly documentId: string;
    readonly contentKeyEpoch: number;
    readonly upperBoundSequence?: number | undefined;
  },
): Promise<string | null> {
  const rows = await executor
    .select({
      checkpointKind: documentAuditCheckpoints.checkpointKind,
      documentId: documentAuditCheckpoints.documentId,
      header: documentContentWriteHeaders.header,
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
      partialStartVersionVector: documentUpdates.partialStartVersionVector,
      plaintextHash: documentUpdates.plaintextHash,
      sourceVersionVector: documentAuditCheckpoints.sourceVersionVector,
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
      and(
        eq(documentAuditCheckpoints.documentId, input.documentId),
        eq(documentAuditCheckpoints.checkpointKind, "rotate_baseline"),
        eq(documentContentWriteHeaders.contentKeyEpoch, input.contentKeyEpoch),
        ...(input.upperBoundSequence === undefined
          ? []
          : [lte(documentUpdates.sequence, input.upperBoundSequence)]),
      ),
    )
    .orderBy(desc(documentAuditCheckpoints.sequence));

  for (const row of rows) {
    if (
      await isAuthenticatedReplayableBaseline({
        checkpointKind: row.checkpointKind,
        documentId: row.documentId,
        metadataHash: row.header.metadataHash,
        partialEndVersionVector: row.partialEndVersionVector,
        partialStartVersionVector: row.partialStartVersionVector,
        plaintextHash: row.plaintextHash,
        sourceVersionVector: row.sourceVersionVector,
        updateId: row.updateId,
      })
    ) {
      return row.sourceVersionVector;
    }
  }
  return null;
}

/**
 * Apply the baseline redirect to a missing-update set. Skips the baseline lookup
 * entirely in the common case where no older-epoch update is present.
 */
export async function selectServedSyncUpdateEntries<
  Entry extends ServableSyncUpdateEntry,
>(input: {
  readonly currentContentKeyEpoch: number;
  readonly documentId: string;
  readonly entries: readonly Entry[];
  readonly executor: DatabaseSession;
  readonly upperBoundSequence?: number | undefined;
}): Promise<Entry[]> {
  const hasOlderEpochUpdate = input.entries.some(
    (entry) => entry.writeHeader.contentKeyEpoch < input.currentContentKeyEpoch,
  );
  if (!hasOlderEpochUpdate) {
    return [...input.entries];
  }

  const baselineCoverage = await loadLatestReadableBaselineCoverage(
    input.executor,
    {
      documentId: input.documentId,
      contentKeyEpoch: input.currentContentKeyEpoch,
      upperBoundSequence: input.upperBoundSequence,
    },
  );

  return selectServedSyncUpdates({
    entries: input.entries,
    currentContentKeyEpoch: input.currentContentKeyEpoch,
    baselineCoverage,
  });
}
