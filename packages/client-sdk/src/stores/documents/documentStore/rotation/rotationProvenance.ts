import {
  encodeVersionVector,
  exportFullHistoryIdentity,
  importUpdates,
  satisfiesVersionVector,
} from "@tearleads/loro";
import type { PendingUpdateRecord } from "../../../../workflows/documents";
import { provenOrdinaryUpdateBytes } from "../history/ordinaryUpdateProof";
import type { DocumentState } from "../state";

function unverifiedLocalHistory(cause?: unknown): Error {
  return new Error(
    "Rotation raw-history recovery found unverified local history; key rotation was not started",
    cause === undefined ? undefined : { cause },
  );
}

function ordinaryPendingUpdateBytes(input: {
  currentDocument: DocumentState;
  pendingUpdates: readonly PendingUpdateRecord[];
}): Uint8Array[] {
  return input.pendingUpdates.flatMap((update) => {
    if (update.sourceVersionVector != null) return [];
    const bytes = provenOrdinaryUpdateBytes(input.currentDocument, update);
    if (!bytes) {
      throw new Error("Ordinary pending-update provenance is inconsistent");
    }
    return [bytes];
  });
}

export function assertExactDocumentHistory(input: {
  currentDocument: DocumentState;
  rebuiltDocument: DocumentState;
}): void {
  const currentVersion = encodeVersionVector(input.currentDocument);
  if (
    !satisfiesVersionVector(
      encodeVersionVector(input.rebuiltDocument),
      currentVersion,
    ) ||
    exportFullHistoryIdentity(input.currentDocument) !==
      exportFullHistoryIdentity(input.rebuiltDocument, currentVersion)
  ) {
    throw unverifiedLocalHistory();
  }
}

/**
 * Prove that the live history is exactly raw remote history plus queued local
 * ordinary deltas. Deterministic operation-log comparison detects checkpoint
 * substitutions that reuse the genuine operations' version-vector identities.
 */
export function importProvenOrdinaryPendingHistory(input: {
  currentDocument: DocumentState;
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
    if (error instanceof Error && error.message.includes("unverified local")) {
      throw error;
    }
    throw unverifiedLocalHistory(error);
  }
}
