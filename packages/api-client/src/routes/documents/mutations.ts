import type {
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentSyncResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function createDocument(
  request: RequestFn,
  input: DocumentCreateRequest,
) {
  return request(
    "/documents",
    isDocumentCreateResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function linkDocument(
  request: RequestFn,
  documentId: string,
  input: DocumentLinkSetMutationRequest,
) {
  return request(
    `/documents/${pathSegment(documentId)}/link`,
    isDocumentLinkSetMutationResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function unlinkDocument(
  request: RequestFn,
  documentId: string,
  input: DocumentLinkSetMutationRequest,
) {
  return request(
    `/documents/${pathSegment(documentId)}/unlink`,
    isDocumentLinkSetMutationResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function syncDocument(
  request: RequestFn,
  documentId: string,
  input: DocumentSyncRequest,
) {
  return request(
    `/documents/${pathSegment(documentId)}/sync`,
    isDocumentSyncResponse,
    "POST",
    JSON.stringify(input),
  );
}
