import type {
  CompleteMultipartBlobStageRequest,
  InitiateMultipartBlobStageRequest,
  UploadMultipartBlobPartRequest,
} from "@tearleads/validators/request";
import {
  isCompleteMultipartBlobStageResponse,
  isInitiateMultipartBlobStageResponse,
  isMultipartBlobStageStatusResponse,
  isUploadMultipartBlobPartResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

const BLOB_PART_BYTE_LENGTH_HEADER = "X-Tearleads-Blob-Part-Byte-Length";
const BLOB_PART_SHA256_HEADER = "X-Tearleads-Blob-Part-Sha256";
const BLOB_PART_UPLOAD_ID_HEADER = "X-Tearleads-Blob-Upload-Id";

export interface UploadMultipartBlobPartBytesRequest {
  readonly byteLength: number;
  readonly encryptedBytes: ReadableStream<Uint8Array>;
  readonly sha256: string;
  readonly uploadId: string;
}

export function initiateMultipartBlobStage(
  request: RequestFn,
  input: InitiateMultipartBlobStageRequest,
) {
  return request(
    "/blobs/stages/multipart",
    isInitiateMultipartBlobStageResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function getMultipartBlobStage(request: RequestFn, stageId: string) {
  return request(
    `/blobs/stages/multipart/${pathSegment(stageId)}`,
    isMultipartBlobStageStatusResponse,
    "GET",
  );
}

export function uploadMultipartBlobPart(
  request: RequestFn,
  stageId: string,
  partNumber: number,
  input: UploadMultipartBlobPartRequest,
) {
  return request(
    `/blobs/stages/multipart/${pathSegment(stageId)}/parts/${pathSegment(partNumber)}`,
    isUploadMultipartBlobPartResponse,
    "PUT",
    JSON.stringify(input),
  );
}

export function uploadMultipartBlobPartBytes(
  request: RequestFn,
  stageId: string,
  partNumber: number,
  input: UploadMultipartBlobPartBytesRequest,
) {
  return request(
    `/blobs/stages/multipart/${pathSegment(stageId)}/parts/${pathSegment(partNumber)}/bytes`,
    isUploadMultipartBlobPartResponse,
    "PUT",
    input.encryptedBytes,
    {
      headers: {
        "Content-Type": "application/octet-stream",
        [BLOB_PART_BYTE_LENGTH_HEADER]: input.byteLength.toString(),
        [BLOB_PART_SHA256_HEADER]: input.sha256,
        [BLOB_PART_UPLOAD_ID_HEADER]: input.uploadId,
      },
    },
  );
}

export function completeMultipartBlobStage(
  request: RequestFn,
  stageId: string,
  input: CompleteMultipartBlobStageRequest,
) {
  return request(
    `/blobs/stages/multipart/${pathSegment(stageId)}/complete`,
    isCompleteMultipartBlobStageResponse,
    "POST",
    JSON.stringify(input),
  );
}
