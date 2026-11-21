import type { DocumentHistoryStop } from "@tearleads/client-sdk";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";

type AttributionSegments = ReadonlyArray<
  DocumentEditAttributionResponse["segments"][number]
>;

/** The signing identity whose signed upload first delivered a stop. */
export interface DocumentHistoryStopWriter {
  readonly writerKeyFingerprint: string;
  readonly writerUserId: string;
}

/**
 * Resolve who uploaded a stop, from the server's edit-attribution segments.
 *
 * A stop is credited only when every one of its operations was first
 * delivered by an ordinary upload from the same signing identity. Anything
 * else stays unknown: part of it has no segment (offline, unsynced, or
 * attribution unavailable), a rotation baseline delivered part of it (a
 * re-assertion, not authorship), or it spans two identities. Checking only
 * the ends would credit a stop whose middle someone else uploaded. Like every
 * attribution here, this names the signed uploader, not proof of who typed
 * the change.
 */
export function resolveDocumentHistoryStopWriter(
  segments: AttributionSegments,
  stop: Pick<DocumentHistoryStop, "endCounter" | "peerId" | "startCounter">,
): DocumentHistoryStopWriter | null {
  const overlapping = segments
    .filter(
      (segment) =>
        segment.peerId === stop.peerId &&
        segment.endCounter > stop.startCounter &&
        segment.startCounter < stop.endCounter,
    )
    .sort((left, right) => left.startCounter - right.startCounter);
  const [first] = overlapping;
  if (first === undefined) {
    return null;
  }

  // Walk the stop's operations in order: each segment must continue where the
  // coverage so far ends, under the same identity.
  let coveredThrough = stop.startCounter;
  for (const segment of overlapping) {
    if (
      segment.authorityKind !== "direct" ||
      segment.writerUserId !== first.writerUserId ||
      segment.writerKeyFingerprint !== first.writerKeyFingerprint ||
      segment.startCounter > coveredThrough
    ) {
      return null;
    }
    coveredThrough = Math.max(coveredThrough, segment.endCounter);
  }
  return coveredThrough >= stop.endCounter
    ? {
        writerKeyFingerprint: first.writerKeyFingerprint,
        writerUserId: first.writerUserId,
      }
    : null;
}
