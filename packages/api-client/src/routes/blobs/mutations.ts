import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "@tearleads/validators/request";
import {
  isBlobAttachmentBindResponse,
  isBlobAttachmentDetachResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function bindBlobAttachment(
  request: RequestFn,
  blobId: string,
  input: BlobAttachmentBindRequest,
) {
  return request(
    `/blobs/${pathSegment(blobId)}/attachment-bindings`,
    isBlobAttachmentBindResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function detachBlobAttachment(
  request: RequestFn,
  blobId: string,
  bindingId: string,
  input: BlobAttachmentDetachRequest,
) {
  return request(
    `/blobs/${pathSegment(blobId)}/attachment-bindings/${pathSegment(bindingId)}/detach`,
    isBlobAttachmentDetachResponse,
    "POST",
    JSON.stringify(input),
  );
}
