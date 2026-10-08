import {
  getDocumentPurgeProofOperation,
  purgeDocumentOperation,
} from "@tearleads/validators/operation";
import type { DocumentPurgeRequest } from "@tearleads/validators/request";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import {
  type DocumentPurgeProofOptions,
  documentPurge,
  documentPurgeProof,
} from "./routes/documents/mutations";
import type { RequestResultOptions } from "./types";

export async function purgeDocument(
  runtime: ApiRequestRuntime,
  documentId: string,
  input: DocumentPurgeRequest,
  options: RequestResultOptions,
) {
  const result = await principalHistoryRequest(runtime, {
    path: documentPurge.path(documentId),
    validator: documentPurge.isResponse,
    method: documentPurge.method,
    body: JSON.stringify(input),
    options,
    operation: purgeDocumentOperation,
  });
  return result.ok ? result.data : null;
}

export async function getDocumentPurgeProof(
  runtime: ApiRequestRuntime,
  documentId: string,
  options: DocumentPurgeProofOptions | undefined,
  requestOptions: RequestResultOptions,
) {
  const result = await principalHistoryRequest(runtime, {
    path: documentPurgeProof.path(documentId, options),
    validator: documentPurgeProof.isResponse,
    method: documentPurgeProof.method,
    options: requestOptions,
    operation: getDocumentPurgeProofOperation,
  });
  return result.ok ? result.data : null;
}
