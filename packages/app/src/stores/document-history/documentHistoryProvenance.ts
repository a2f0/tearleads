import type {
  DocumentHistoryStop,
  DocumentHistoryVerifiedRange,
} from "@tearleads/client-sdk";

/**
 * Where the server's signed history holds a stop's operations, as a
 * verification on this device found:
 *
 * - `direct`: an ordinary signed upload first carried every one of them.
 * - `baseline`: the server holds them all, but at least one only in a
 *   key-rotation snapshot, so it is what that snapshot's signer asserted.
 * - `partial`: the server holds some of them and not others.
 * - `absent`: the server holds none. The device has not uploaded the change,
 *   or the server no longer serves it; a verification cannot tell which.
 */
export type DocumentHistoryStopProvenance =
  | "absent"
  | "baseline"
  | "direct"
  | "partial";

type VerifiedRanges = ReadonlyArray<
  Pick<
    DocumentHistoryVerifiedRange,
    "authorityKind" | "endCounter" | "peerId" | "startCounter"
  >
>;

/**
 * Resolve a stop's provenance from a verification's ranges. Every operation
 * of the stop is looked at, not only its ends: a stop is a second of one
 * writer's edits, and an upload can carry part of one.
 */
export function resolveDocumentHistoryStopProvenance(
  ranges: VerifiedRanges,
  stop: Pick<DocumentHistoryStop, "endCounter" | "peerId" | "startCounter">,
): DocumentHistoryStopProvenance {
  const overlapping = ranges
    .filter(
      (range) =>
        range.peerId === stop.peerId &&
        range.endCounter > stop.startCounter &&
        range.startCounter < stop.endCounter,
    )
    .sort((left, right) => left.startCounter - right.startCounter);
  if (overlapping.length === 0) return "absent";

  // Walk the stop's operations in order: each range must continue where the
  // coverage so far ends.
  let coveredThrough = stop.startCounter;
  for (const range of overlapping) {
    if (range.startCounter > coveredThrough) return "partial";
    coveredThrough = Math.max(coveredThrough, range.endCounter);
  }
  if (coveredThrough < stop.endCounter) return "partial";
  return overlapping.every((range) => range.authorityKind === "direct")
    ? "direct"
    : "baseline";
}
