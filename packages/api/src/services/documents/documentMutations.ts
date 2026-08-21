import type { DocumentCreateResponse } from "@symcrypt/validators/response";
import {
  type CreateDocumentInput,
  type DocumentLinkSetMutationWorkflowResult,
  type DocumentSyncWorkflowResult,
  type MutateDocumentLinkSetInput,
  type PurgeDocumentWorkflowResult,
  runCreateDocumentWorkflow,
  runDocumentLinkSetMutationWorkflow,
  runDocumentSyncWorkflow,
  runPurgeDocumentWorkflow,
  type SyncDocumentInput,
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

export const syncDocument = createDatabaseWorkflowService<
  SyncDocumentInput,
  DocumentSyncWorkflowResult
>(runDocumentSyncWorkflow);

export async function purgeDocument(
  runtime: ApiServiceRuntime,
  input: {
    readonly documentId: string;
    readonly userId: string;
  },
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
