import type {
  DocumentV2CreateRequest,
  DocumentV2LinkSetMutationRequest,
  DocumentV2SyncRequest,
} from "@tearleads/validators/request";
import {
  isDocumentV2CreateResponse,
  isDocumentV2LinkSetMutationResponse,
  isDocumentV2SyncResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function createDocumentV2(
  request: RequestFn,
  input: DocumentV2CreateRequest,
) {
  return request(
    "/v2/documents",
    isDocumentV2CreateResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function linkDocumentV2(
  request: RequestFn,
  documentId: string,
  input: DocumentV2LinkSetMutationRequest,
) {
  return request(
    `/v2/documents/${documentId}/link`,
    isDocumentV2LinkSetMutationResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function unlinkDocumentV2(
  request: RequestFn,
  documentId: string,
  input: DocumentV2LinkSetMutationRequest,
) {
  return request(
    `/v2/documents/${documentId}/unlink`,
    isDocumentV2LinkSetMutationResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function syncDocumentV2(
  request: RequestFn,
  documentId: string,
  input: DocumentV2SyncRequest,
) {
  return request(
    `/v2/documents/${documentId}/sync`,
    isDocumentV2SyncResponse,
    "POST",
    JSON.stringify(input),
  );
}
