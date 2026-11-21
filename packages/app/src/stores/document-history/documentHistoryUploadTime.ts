import type { DocumentHistoryStop } from "@tearleads/client-sdk";
import type { DocumentEditAttributionRangeResponse } from "@tearleads/validators/response";

type UploadRanges = ReadonlyArray<
  Pick<
    DocumentEditAttributionRangeResponse,
    "createdAt" | "endCounter" | "peerId" | "startCounter"
  >
>;

/**
 * When the server stored the upload that first delivered a stop's first
 * operation, in Unix milliseconds, or null when no range covers it (offline,
 * unsynced, or attribution unavailable).
 *
 * A change carries one time, taken when it begins, so its first operation
 * dates it. The server stored that operation at this moment by its own clock,
 * so the change began no later, whatever the writing device's clock said.
 * That holds for any upload, a rotation baseline included: the bound is on
 * when the operation existed, not on who wrote it.
 */
export function resolveDocumentHistoryStopUploadedAt(
  ranges: UploadRanges,
  stop: Pick<DocumentHistoryStop, "peerId" | "startCounter">,
): number | null {
  const range = ranges.find(
    (candidate) =>
      candidate.peerId === stop.peerId &&
      candidate.startCounter <= stop.startCounter &&
      stop.startCounter < candidate.endCounter,
  );
  if (range === undefined) return null;
  const storedAt = Date.parse(range.createdAt);
  return Number.isFinite(storedAt) ? storedAt : null;
}

/**
 * How far a device's time may run past its upload before History says so.
 * Ordinary clocks differ by seconds; the time is corrected either way, and
 * the notice is kept for a clock that is plainly wrong.
 */
export const DOCUMENT_HISTORY_CLOCK_AHEAD_NOTICE_MS = 60_000;

/** The time History shows for a change. */
export interface DocumentHistoryStopTime {
  /** Unix milliseconds, or null when the change recorded no time. */
  readonly at: number | null;
  /**
   * The writing device's clock was ahead by more than the notice threshold:
   * `at` is when the change was uploaded, not the time the device recorded.
   */
  readonly clockAhead: boolean;
}

/**
 * The lesser of the time a change recorded and the time it was uploaded. A
 * change cannot have been made after the server stored it, so a recorded time
 * past its upload is the device's clock running ahead. Documents never record
 * a time earlier than the newest one they hold, so one such clock moves every
 * later change forward too; each is bounded by its own upload. A clock that
 * runs behind cannot be told from here.
 */
export function boundDocumentHistoryStopTime(
  committedAt: number | null,
  uploadedAt: number | null,
): DocumentHistoryStopTime {
  if (committedAt === null || uploadedAt === null) {
    return { at: committedAt, clockAhead: false };
  }
  if (committedAt <= uploadedAt) {
    return { at: committedAt, clockAhead: false };
  }
  return {
    at: uploadedAt,
    clockAhead:
      committedAt - uploadedAt > DOCUMENT_HISTORY_CLOCK_AHEAD_NOTICE_MS,
  };
}
