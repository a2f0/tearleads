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
    `/blobs/stages/multipart/${stageId}`,
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
    `/blobs/stages/multipart/${stageId}/parts/${partNumber}`,
    isUploadMultipartBlobPartResponse,
    "PUT",
    JSON.stringify(input),
  );
}

export function completeMultipartBlobStage(
  request: RequestFn,
  stageId: string,
  input: CompleteMultipartBlobStageRequest,
) {
  return request(
    `/blobs/stages/multipart/${stageId}/complete`,
    isCompleteMultipartBlobStageResponse,
    "POST",
    JSON.stringify(input),
  );
}
