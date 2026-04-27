import type {
  BlobV2AttachmentBindRequest,
  BlobV2AttachmentDetachRequest,
} from "@tearleads/validators/request";
import {
  isBlobV2AttachmentBindResponse,
  isBlobV2AttachmentDetachResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function bindBlobAttachmentV2(
  request: RequestFn,
  blobId: string,
  input: BlobV2AttachmentBindRequest,
) {
  return request(
    `/v2/blobs/${blobId}/attachment-bindings`,
    isBlobV2AttachmentBindResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function detachBlobAttachmentV2(
  request: RequestFn,
  blobId: string,
  bindingId: string,
  input: BlobV2AttachmentDetachRequest,
) {
  return request(
    `/v2/blobs/${blobId}/attachment-bindings/${bindingId}/detach`,
    isBlobV2AttachmentDetachResponse,
    "POST",
    JSON.stringify(input),
  );
}
