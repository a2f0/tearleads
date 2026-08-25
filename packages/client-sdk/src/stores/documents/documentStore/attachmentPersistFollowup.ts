import type { PersistedDocumentRecord } from "./state";

/**
 * A same-identity conflict may still leave newer durable work for the current
 * lane to submit. Identity replacement and local teardown deliberately do not
 * schedule the losing document against the replacement generation.
 */
export function attachmentPersistNeedsFollowupSync(input: {
  currentDocumentId: string | null | undefined;
  currentLocalWriteGeneration: number;
  expectedDocumentId: string | null;
  expectedLocalWriteGeneration: number;
  persisted: PersistedDocumentRecord | null;
}): boolean {
  if (
    input.currentLocalWriteGeneration !== input.expectedLocalWriteGeneration ||
    input.currentDocumentId !== input.expectedDocumentId
  ) {
    return false;
  }
  if (!input.persisted) return true;
  return (
    input.persisted.pullContinuationSuperseded === true &&
    input.persisted.syncIdentitySuperseded !== true
  );
}
