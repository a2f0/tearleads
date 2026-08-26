import type { DocumentCreateResponse } from "@symcrypt/validators/response";
import {
  type CreateDocumentInput,
  type DocumentLinkSetMutationWorkflowResult,
  type DocumentSyncWorkflowResult,
  loadDocumentPurgeProof,
  type MutateDocumentLinkSetInput,
  type PurgeDocumentInput,
  type PurgeDocumentWorkflowResult,
  runCreateDocumentWorkflow,
  runDocumentLinkSetMutationWorkflow,
  runDocumentSyncWorkflow,
  runPurgeDocumentWorkflow,
  type SyncDocumentInput,
  toMutationError,
} from "../../workflows/documents/mutations";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";
import type { ApiServiceRuntime } from "../runtime";

export { DocumentMutationError } from "../../workflows/documents/mutations";

export const createDocument = createDatabaseWorkflowService<
  CreateDocumentInput,
  DocumentCreateResponse
>(runCreateDocumentWorkflow);

export const mutateDocumentLinkSet = createDatabaseWorkflowService<
  MutateDocumentLinkSetInput,
  DocumentLinkSetMutationWorkflowResult
>(runDocumentLinkSetMutationWorkflow);

export function syncDocument(
  runtime: ApiServiceRuntime,
  input: SyncDocumentInput,
): Promise<DocumentSyncWorkflowResult> {
  return runDocumentSyncWorkflow(
    runtime.db,
    input,
    runtime.documentSyncCursorHmacKey,
  );
}

export async function purgeDocument(
  runtime: ApiServiceRuntime,
  input: PurgeDocumentInput,
): Promise<PurgeDocumentWorkflowResult> {
  const result = await runPurgeDocumentWorkflow(runtime.db, input);

  // The workflow committed the row deletions and returned the object-store keys
  // for blobs that became fully orphaned. Delete those bytes after commit (in
  // parallel — they are independent): a rollback never leaves dangling
  // references, and a storage failure here only leaks reclaimable bytes rather
  // than failing the purge.
  await Promise.all(
    result.response.reclaimedBlobStorageKeys.map(async (storageKey) => {
      try {
        await runtime.blobObjectStore.deleteObject(storageKey);
      } catch {
        // Best-effort: the blob row is already gone, so leave the bytes for a
        // future sweep.
      }
    }),
  );

  return result;
}

export function getDocumentPurgeProof(
  runtime: ApiServiceRuntime,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
): Promise<Awaited<ReturnType<typeof loadDocumentPurgeProof>>> {
  return runtime.db
    .transaction((tx) => loadDocumentPurgeProof({ ...input, executor: tx }))
    .catch((error: unknown) => {
      const mutationError = toMutationError(error);
      throw mutationError ?? error;
    });
}
