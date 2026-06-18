import type {
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentPurgeResponse,
  DocumentSyncResponse,
} from "@tearleads/validators/response";
import {
  type CreateDocumentInput,
  type MutateDocumentLinkSetInput,
  runCreateDocumentWorkflow,
  runDocumentLinkSetMutationWorkflow,
  runDocumentSyncWorkflow,
  runPurgeDocumentWorkflow,
  type SyncDocumentInput,
} from "../../workflows/documents/mutations";
import type { ApiServiceRuntime } from "../runtime";

export { DocumentMutationError } from "../../workflows/documents/mutations";

export async function createDocument(
  runtime: ApiServiceRuntime,
  input: CreateDocumentInput,
): Promise<DocumentCreateResponse> {
  return runCreateDocumentWorkflow(runtime.db, input);
}

export async function mutateDocumentLinkSet(
  runtime: ApiServiceRuntime,
  input: MutateDocumentLinkSetInput,
): Promise<DocumentLinkSetMutationResponse> {
  return runDocumentLinkSetMutationWorkflow(runtime.db, input);
}

export async function syncDocument(
  runtime: ApiServiceRuntime,
  input: SyncDocumentInput,
): Promise<DocumentSyncResponse> {
  return runDocumentSyncWorkflow(runtime.db, input);
}

export async function purgeDocument(
  runtime: ApiServiceRuntime,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<DocumentPurgeResponse> {
  const response = await runPurgeDocumentWorkflow(runtime.db, input);

  // The workflow committed the row deletions and returned the object-store keys
  // for blobs that became fully orphaned. Delete those bytes after commit: a
  // rollback never leaves dangling references, and a storage failure here only
  // leaks reclaimable bytes rather than failing the purge.
  for (const storageKey of response.reclaimedBlobStorageKeys) {
    try {
      await runtime.blobObjectStore.deleteObject(storageKey);
    } catch {
      // Best-effort: the blob row is already gone, so leave the bytes for a
      // future sweep.
    }
  }

  return response;
}
