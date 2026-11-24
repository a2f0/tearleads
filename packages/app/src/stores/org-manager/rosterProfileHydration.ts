import type { Documents } from "@tearleads/client-sdk";

/**
 * Opens one roster profile on demand and pulls its remote state. The API
 * withholds roster profiles from container listings because they carry member
 * PII, so an admin's device gets a profile it did not write only by its id.
 * A row that already holds the document keeps its local id; otherwise the
 * pull persists it under `localId`. Resolves true once the pull completed.
 */
export async function hydrateRosterProfileDocument(input: {
  readonly containerId: string;
  readonly documents: Pick<Documents, "findLocalIdByDocumentId" | "open">;
  readonly localId: string;
  readonly profileDocumentId: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<boolean> {
  if (input.signal?.aborted) {
    return false;
  }
  const persistedLocalId = await input.documents.findLocalIdByDocumentId(
    input.profileDocumentId,
  );
  if (input.signal?.aborted) {
    return false;
  }
  return input.documents
    .open(
      {
        containerId: input.containerId,
        documentId: input.profileDocumentId,
        localId: persistedLocalId ?? input.localId,
      },
      { remoteSyncMode: "on-demand" },
    )
    .requestRemoteSyncAndWait(input.signal);
}
