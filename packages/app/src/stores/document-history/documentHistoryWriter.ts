import {
  type DocumentHistoryStop,
  resolveOpIdAttribution,
} from "@tearleads/client-sdk";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";

type AttributionSegments = DocumentEditAttributionResponse["segments"];

/** The signing identity whose signed upload first delivered a stop. */
export interface DocumentHistoryStopWriter {
  readonly writerKeyFingerprint: string;
  readonly writerUserId: string;
}

/**
 * Resolve who uploaded a stop, from the server's edit-attribution segments.
 *
 * A stop is credited only when its first and last operations were both first
 * delivered by an ordinary upload from the same signing identity. Anything
 * else stays unknown: no segment covers it (offline, unsynced, or attribution
 * unavailable), a rotation baseline delivered it (a re-assertion, not
 * authorship), or the stop spans two identities. Like every attribution here,
 * this names the signed uploader, not proof of who typed the change.
 */
export function resolveDocumentHistoryStopWriter(
  segments: AttributionSegments,
  stop: Pick<DocumentHistoryStop, "endCounter" | "peerId" | "startCounter">,
): DocumentHistoryStopWriter | null {
  const first = resolveOpIdAttribution(
    segments,
    stop.peerId,
    stop.startCounter,
  );
  const last = resolveOpIdAttribution(
    segments,
    stop.peerId,
    stop.endCounter - 1,
  );
  if (
    first === null ||
    last === null ||
    first.authorityKind !== "direct" ||
    last.authorityKind !== "direct" ||
    first.writerUserId !== last.writerUserId ||
    first.writerKeyFingerprint !== last.writerKeyFingerprint
  ) {
    return null;
  }
  return {
    writerKeyFingerprint: first.writerKeyFingerprint,
    writerUserId: first.writerUserId,
  };
}
