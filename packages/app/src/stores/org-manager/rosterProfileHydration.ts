import {
  type Documents,
  getRosterProfileDocumentLocalId,
} from "@tearleads/client-sdk";

/**
 * The local id a pulled roster profile is persisted under when this device
 * holds no row for it. It names the profile document, not only the member: a
 * member whose profile pointer was replaced may still hold the previous
 * profile under the canonical id, and opening the new one there would reuse
 * that profile's store.
 */
export function getRosterProfileHydrationLocalId(input: {
  readonly organizationId: string;
  readonly profileDocumentId: string;
  readonly userId: string;
}): string {
  return `${getRosterProfileDocumentLocalId(input)}:remote:${input.profileDocumentId}`;
}

/**
 * Opens one roster profile on demand and pulls its remote state. The API
 * withholds roster profiles from container listings because they carry member
 * PII, so an admin's device gets a profile it did not write only by its id.
 * A row that already holds the document keeps its local id; otherwise the
 * pull persists it under `getRosterProfileHydrationLocalId`. Resolves true
 * once the pull completed.
 */
export async function hydrateRosterProfileDocument(input: {
  readonly containerId: string;
  readonly documents: Pick<Documents, "findLocalIdByDocumentId" | "open">;
  readonly organizationId: string;
  readonly profileDocumentId: string;
  readonly signal?: AbortSignal | undefined;
  readonly userId: string;
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
        localId: persistedLocalId ?? getRosterProfileHydrationLocalId(input),
      },
      { remoteSyncMode: "on-demand" },
    )
    .requestRemoteSyncAndWait(input.signal);
}
