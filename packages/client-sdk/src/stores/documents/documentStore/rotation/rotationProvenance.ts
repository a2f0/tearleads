import {
  encodeVersionVector,
  exportFullHistoryIdentity,
  importUpdates,
  satisfiesVersionVector,
} from "@tearleads/loro";
import type { PendingUpdateRecord } from "../../../../workflows/documents";
import { provenOrdinaryUpdateBytes } from "../history/ordinaryUpdateProof";
import type { DocumentState } from "../state";

const UNVERIFIED_LOCAL_HISTORY =
  "Rotation raw-history recovery found unverified local history; key rotation was not started";

/**
 * The rebuilt history did not equal the live document's, as compared: no
 * failure along the way, which would say nothing of the rebuild.
 */
export class RotationHistoryMismatchError extends Error {
  constructor(
    /**
     * Whether the live document holds counters that only an update the
     * rebuild left out declares, and so holds that update.
     */
    readonly heldLeftOut: boolean,
  ) {
    super(UNVERIFIED_LOCAL_HISTORY);
  }
}

function unverifiedLocalHistory(cause: unknown): Error {
  return new Error(UNVERIFIED_LOCAL_HISTORY, { cause });
}

function ordinaryPendingUpdateBytes(input: {
  currentDocument: DocumentState;
  pendingUpdates: readonly PendingUpdateRecord[];
}): Uint8Array[] {
  return input.pendingUpdates.flatMap((update) => {
    const bytes = provenOrdinaryUpdateBytes(input.currentDocument, update);
    if (!bytes) {
      throw new Error("Ordinary pending-update provenance is inconsistent");
    }
    return [bytes];
  });
}

export function assertExactDocumentHistory(input: {
  currentDocument: DocumentState;
  /** The declared end versions of updates the rebuild left out, unread. */
  leftOutEnds?: readonly string[] | undefined;
  rebuiltDocument: DocumentState;
}): void {
  const currentVersion = encodeVersionVector(input.currentDocument);
  const rebuiltVersion = encodeVersionVector(input.rebuiltDocument);
  if (
    !satisfiesVersionVector(rebuiltVersion, currentVersion) ||
    exportFullHistoryIdentity(input.currentDocument) !==
      exportFullHistoryIdentity(input.rebuiltDocument, currentVersion)
  ) {
    throw new RotationHistoryMismatchError(
      (input.leftOutEnds ?? []).some(
        (end) =>
          satisfiesVersionVector(currentVersion, end) &&
          !satisfiesVersionVector(rebuiltVersion, end),
      ),
    );
  }
}

/**
 * Prove that the live history is exactly raw remote history plus queued local
 * ordinary deltas. Deterministic operation-log comparison detects checkpoint
 * substitutions that reuse the genuine operations' version-vector identities.
 */
export function importProvenOrdinaryPendingHistory(input: {
  currentDocument: DocumentState;
  leftOutEnds: readonly string[];
  pendingUpdates: readonly PendingUpdateRecord[];
  rebuiltDocument: DocumentState;
}): string {
  try {
    const updates = ordinaryPendingUpdateBytes({
      currentDocument: input.currentDocument,
      pendingUpdates: input.pendingUpdates,
    });
    if (updates.length > 0) importUpdates(input.rebuiltDocument, updates);
    assertExactDocumentHistory(input);
    return encodeVersionVector(input.currentDocument);
  } catch (error) {
    if (error instanceof RotationHistoryMismatchError) throw error;
    throw unverifiedLocalHistory(error);
  }
}
