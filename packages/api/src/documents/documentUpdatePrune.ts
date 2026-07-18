import { isDocumentUpdateDominatedByBaseline } from "./documentBaselineDominance";

/**
 * Compaction planning for document-update storage reclamation.
 *
 * A rotate_baseline is a full state export re-encrypted under the post-rotation
 * content key. Once it exists, every pre-rotation update it dominates is dead
 * weight: the sync baseline-redirect never serves those updates (the baseline
 * carries their state forward) and no current reader can decrypt them anyway.
 * Clearing their encrypted payload reclaims the bulk of the storage while the
 * row — and its attribution metadata (spans + write header) — is left intact.
 *
 * This module is the pure selection: which update ids are safe to prune. The
 * per-update domination predicate is shared with the sync redirect
 * (isDocumentUpdateDominatedByBaseline), but the gates are NOT identical:
 * prune clears payloads dominated by ANY higher-epoch replayable baseline,
 * while the redirect only ever substitutes a CURRENT-epoch baseline, and a
 * cleared row is hidden from serving unconditionally (encrypted_data <> '')
 * rather than through the redirect's coverage gate. Safety therefore rests on
 * induction over baseline coverage — every baseline is written under the
 * rotation head-lock and must cover the committed frontier, so a payload this
 * plan clears is carried forward by the baseline chain even when the epoch
 * that dominated it is no longer current — not on the redirect re-deriving
 * each pruned update.
 */

export interface PruneBaseline {
  /** Document the rotate_baseline belongs to. */
  readonly documentId: string;
  /** The baseline's `sourceVersionVector` (its full coverage frontier). */
  readonly sourceVersionVector: string;
  /** Content-key epoch the baseline update was written under. */
  readonly baselineEpoch: number;
}

export interface PruneCandidate {
  readonly id: string;
  readonly documentId: string;
  /** Content-key epoch this update was written under. */
  readonly contentKeyEpoch: number;
  /** Bytes reclaimable by clearing this update's payload. */
  readonly byteLength: number;
  /** The update's `partialEndVersionVector` (what the baseline must dominate). */
  readonly partialEndVersionVector: string;
}

interface UpdatePrunePlan {
  readonly updateIds: string[];
  readonly reclaimedBytes: number;
  readonly documentIds: string[];
}

/**
 * Select the updates whose payload is safe to clear: a pre-rotation update
 * (`contentKeyEpoch` strictly below a baseline's epoch) that the baseline's
 * `sourceVersionVector` dominates. Deterministic and capped at `limit`.
 */
export function planDominatedUpdatePrune(input: {
  readonly baselines: readonly PruneBaseline[];
  readonly candidates: readonly PruneCandidate[];
  readonly limit: number;
}): UpdatePrunePlan {
  const baselinesByDocument = new Map<string, PruneBaseline[]>();
  for (const baseline of input.baselines) {
    const list = baselinesByDocument.get(baseline.documentId);
    if (list) {
      list.push(baseline);
    } else {
      baselinesByDocument.set(baseline.documentId, [baseline]);
    }
  }

  const prunedIds = new Set<string>();
  const documentIds = new Set<string>();
  let reclaimedBytes = 0;

  for (const candidate of input.candidates) {
    if (prunedIds.size >= input.limit) {
      break;
    }
    if (prunedIds.has(candidate.id)) {
      continue;
    }
    const baselines = baselinesByDocument.get(candidate.documentId);
    if (!baselines) {
      continue;
    }
    const dominatingBaseline = baselines.find((baseline) =>
      isDocumentUpdateDominatedByBaseline({
        baselineEpoch: baseline.baselineEpoch,
        baselineVersionVector: baseline.sourceVersionVector,
        updateEpoch: candidate.contentKeyEpoch,
        updateVersionVector: candidate.partialEndVersionVector,
      }),
    );
    if (!dominatingBaseline) {
      continue;
    }
    prunedIds.add(candidate.id);
    documentIds.add(candidate.documentId);
    reclaimedBytes += candidate.byteLength;
  }

  return {
    updateIds: [...prunedIds],
    reclaimedBytes,
    documentIds: [...documentIds],
  };
}
