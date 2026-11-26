import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { mergeVersionVectors } from "@tearleads/loro";
import { isDocumentUpdateDominatedByBaseline } from "./documentBaselineDominance";
import { readProcessedThroughSequence } from "./documentProcessedCursor";
import { loadLatestStoredDocumentBaselineGroup } from "./documentStoredBaselineGroup";
import { hasMissingDocumentUpdatesThroughSequence } from "./documentUpdateStore";

/**
 * Coverage-gated baseline redirect for document sync pulls.
 *
 * The frontier diff returns every update a reader is missing, regardless of the
 * content-key epoch it was written under. A reader added after a container-KEK
 * rotation cannot unwrap the pre-rotation epochs, and the client decrypt path is
 * all-or-nothing — one undecryptable update poisons the whole batch, so the
 * reader never converges (see the post-rotation-reader-convergence repro).
 *
 * A rotation baseline is the document's whole history written again under
 * the current content key, as an ordered group of updates (its segments)
 * committed together. So it both (a) is readable by every current reader
 * (including newcomers) and (b) carries the operations of all pre-rotation
 * updates it dominates. When the missing set spans an older content-key
 * epoch, we therefore redirect the reader to the latest whole current-epoch
 * baseline and omit the older-epoch updates it covers — but ONLY when the
 * baseline provably dominates every one of them.
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
  readonly historyMode?: "raw" | undefined;
}): Entry[] {
  if (input.historyMode === "raw") {
    return [...input.entries];
  }
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

export async function loadLatestReadableBaselineCoverage(
  executor: DatabaseSession,
  input: {
    readonly documentId: string;
    readonly contentKeyEpoch: number;
    readonly upperBoundSequence?: number | undefined;
  },
): Promise<string | null> {
  return (
    (await loadLatestStoredDocumentBaselineGroup(executor, input))?.coverage ??
    null
  );
}

/**
 * Move a pull's first page directly to a readable baseline when it covers
 * every update the client is missing between where the page starts and that
 * baseline. A first page starts after the client's processed cursor, if it
 * sent one, and updates at or before the cursor were judged already, so they
 * neither need the baseline nor keep it from serving. A baseline covers every
 * update at or before its own signed cursor, which its author imported or
 * voided, and each later one whose operations its segments hold. The page
 * then starts just before the baseline's first segment, and the segments are
 * served as ordinary updates, over as many pages as they take. A
 * continuation page keeps its position. This decision happens before the
 * bounded page query, so a long run of covered old-epoch updates cannot
 * consume empty pages and starve the baseline itself.
 */
export async function resolveBaselineRedirectAfterSequence(input: {
  readonly afterSequence: number;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly executor: DatabaseSession;
  /** Whether this is a pull's first page, sent with no pull cursor. */
  readonly firstPage: boolean;
  readonly localVersionVector: string | null;
  readonly upperBoundSequence: number;
}): Promise<number> {
  if (!input.firstPage) return input.afterSequence;
  const baseline = await loadLatestStoredDocumentBaselineGroup(input.executor, {
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: input.documentId,
    upperBoundSequence: input.upperBoundSequence,
  });
  if (!baseline) return input.afterSequence;

  const beforeBaseline = baseline.firstSequence - 1;
  if (beforeBaseline <= input.afterSequence) return input.afterSequence;
  const missingBeforeBaseline = (
    afterSequence: number,
    localVersionVector: string | null,
  ) =>
    hasMissingDocumentUpdatesThroughSequence(input.executor, {
      afterSequence,
      documentId: input.documentId,
      localVersionVector,
      upperBoundSequence: beforeBaseline,
    });
  if (
    !(await missingBeforeBaseline(
      input.afterSequence,
      input.localVersionVector,
    ))
  ) {
    return input.afterSequence;
  }

  // The baseline's author imported or voided every update up to its signed
  // cursor, so the segments stand for those; later ones must be covered.
  const coveredThrough = await readProcessedThroughSequence(input.executor, {
    documentId: input.documentId,
    processedThroughUpdateId: baseline.coversThroughUpdateId,
  });
  const coveredFrontier = mergeVersionVectors([
    ...(input.localVersionVector === null ? [] : [input.localVersionVector]),
    baseline.coverage,
  ]);
  return (await missingBeforeBaseline(
    Math.max(input.afterSequence, coveredThrough),
    coveredFrontier,
  ))
    ? input.afterSequence
    : beforeBaseline;
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
