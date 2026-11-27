/**
 * The operations that unapplied segments of one rotation baseline declared,
 * which is what excuses a later segment of the group that cannot join the
 * reader's history: one span a peer.
 *
 * One span is enough. The API commits a group only when each segment starts
 * where the ones before it end, so the spans a group's segments declare on
 * one peer run on from each other. Unapplied segments that follow each
 * other on a peer merge into one span. One that starts past the span before
 * it means the reader holds the operations between, since an honest server
 * serves every segment the reader lacks part of; it then holds every
 * earlier operation of that peer too, and the earlier span can excuse
 * nothing it lacks.
 */
import { compareCanonicalStrings } from "@tearleads/crypto";
import { isLoroRuntimeFailure, listVersionVectorSpans } from "@tearleads/loro";
import type { DocumentOperationSpan } from "./documentUpdateVerdict";

/**
 * The most unapplied spans a pull carries for one rotation baseline, which
 * is the most peers its unapplied segments may name one by one. The run is
 * kept in memory and stored with the pull's continuation, so it is bounded.
 * A stored run longer than this is not one this reader wrote.
 */
export const MAX_UNAPPLIED_BASELINE_SPANS = 8_192;

/**
 * What a run carries once its group's unapplied segments name more peers
 * than `MAX_UNAPPLIED_BASELINE_SPANS`: every operation of the group counts
 * as one an unapplied segment declared.
 *
 * The API bounds a segment's spans only by its stage's total, so a writing
 * member can commit a group whose void segments name any number of peers.
 * Failing the pass on it would stop every reader of the document for good,
 * for one member's doing. Its writer signed segments no reader takes, over
 * more of the history than a pull will list, so the rest of that writer's
 * group is taken on the same terms: a later segment that cannot join the
 * reader's history is void, as it is after any void segment it builds on.
 * Only void segments are unapplied, so a group its writer did not break
 * never carries this.
 */
export const EVERY_OPERATION_UNAPPLIED = "every_operation";

/** What a run carries of its group's unapplied operations between pages. */
export type CarriedUnappliedOperations =
  | readonly DocumentOperationSpan[]
  | typeof EVERY_OPERATION_UNAPPLIED;

export type UnappliedOperations =
  | ReadonlyMap<string, DocumentOperationSpan>
  | typeof EVERY_OPERATION_UNAPPLIED;

interface DeclaredVectors {
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
}

/** The unapplied operations a run carried from the pages before. */
export function unappliedOperationsOf(
  carried: CarriedUnappliedOperations,
): UnappliedOperations {
  return carried === EVERY_OPERATION_UNAPPLIED
    ? carried
    : new Map(carried.map((span) => [span.peerId, span]));
}

/**
 * What a run carries to the next page: one span a peer, in peer order, or
 * every operation once the spans are more than a pull lists.
 */
export function carriedUnappliedOperations(
  unapplied: UnappliedOperations,
): CarriedUnappliedOperations {
  if (
    unapplied === EVERY_OPERATION_UNAPPLIED ||
    unapplied.size > MAX_UNAPPLIED_BASELINE_SPANS
  ) {
    return EVERY_OPERATION_UNAPPLIED;
  }
  return [...unapplied.values()].sort((left, right) =>
    compareCanonicalStrings(left.peerId, right.peerId),
  );
}

/**
 * The spans a segment's signed vectors declare. Vectors that do not decode
 * as a span declare none, and so excuse nothing.
 */
function declaredSpans(segment: DeclaredVectors): DocumentOperationSpan[] {
  try {
    return listVersionVectorSpans(segment);
  } catch (error) {
    if (isLoroRuntimeFailure(error)) throw error;
    return [];
  }
}

function touches(
  left: DocumentOperationSpan,
  right: DocumentOperationSpan,
): boolean {
  return (
    left.startCounter <= right.endCounter &&
    right.startCounter <= left.endCounter
  );
}

/** `unapplied` with the operations an unapplied `segment` declares. */
export function withUnappliedSegment(
  unapplied: UnappliedOperations,
  segment: DeclaredVectors,
): UnappliedOperations {
  if (unapplied === EVERY_OPERATION_UNAPPLIED) return unapplied;
  const next = new Map(unapplied);
  for (const span of declaredSpans(segment)) {
    const known = next.get(span.peerId);
    next.set(
      span.peerId,
      known && touches(known, span)
        ? {
            endCounter: Math.max(known.endCounter, span.endCounter),
            peerId: span.peerId,
            startCounter: Math.min(known.startCounter, span.startCounter),
          }
        : span,
    );
  }
  return next;
}

/**
 * Whether every operation in `missing` is one an unapplied segment declared.
 * A segment that lacks only those builds on segments no reader takes. One
 * that lacks any other was served without a segment that supplies it.
 */
export function unappliedSegmentsDeclared(
  unapplied: UnappliedOperations,
  missing: readonly DocumentOperationSpan[],
): boolean {
  if (unapplied === EVERY_OPERATION_UNAPPLIED) return true;
  return missing.every((span) => {
    const declared = unapplied.get(span.peerId);
    return (
      declared !== undefined &&
      declared.startCounter <= span.startCounter &&
      span.endCounter <= declared.endCounter
    );
  });
}
