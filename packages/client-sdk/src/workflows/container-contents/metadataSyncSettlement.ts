import { base64ToBytes } from "@symcrypt/encoding";
import { importUpdates } from "@symcrypt/loro";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { DocumentSyncPullContinuation } from "../../data/documents/shared/syncPagination";
import type { ContainerDocumentRecord as DocumentRecord } from "./containerPersistence";
import type { ContainerMetadataState } from "./metadataTypes";

export interface ExpectedContainerMetadataSyncState {
  pullContinuation: DocumentSyncPullContinuation | null;
  record: DocumentRecord;
}

export function sameNullableMetadataValue(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

export function metadataSyncSecurityContextMatches(
  current: DocumentRecord | null,
  expected: DocumentRecord,
): boolean {
  return (
    current !== null &&
    current.id === expected.id &&
    current.documentId === expected.documentId &&
    current.accessEpoch === expected.accessEpoch &&
    sameNullableMetadataValue(
      current.accessStateHash,
      expected.accessStateHash,
    ) &&
    sameNullableMetadataValue(
      current.contentKeyBundle,
      expected.contentKeyBundle,
    ) &&
    sameNullableMetadataValue(
      current.documentKekTargets,
      expected.documentKekTargets,
    ) &&
    sameNullableMetadataValue(
      current.documentManifestBundle,
      expected.documentManifestBundle,
    )
  );
}

export async function replaceSupersededMetadataIdentity(input: {
  durableRecord: DocumentRecord | null;
  metadataState: ContainerMetadataState;
}): Promise<void> {
  const replacementDoc = await createContainerMetadataDocument(
    input.metadataState.container.id,
  );
  if (input.durableRecord?.metadataUpdates) {
    importUpdates(replacementDoc, [
      base64ToBytes(input.durableRecord.metadataUpdates),
    ]);
  }
  input.metadataState.doc = replacementDoc;
  input.metadataState.metadataWriterProjection = null;
}
