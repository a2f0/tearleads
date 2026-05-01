import type {
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentSyncResponse,
} from "@tearleads/validators/response";
import {
  type CreateDocumentInput,
  type MutateDocumentLinkSetInput,
  runCreateDocumentWorkflow,
  runDocumentLinkSetMutationWorkflow,
  runDocumentSyncWorkflow,
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
