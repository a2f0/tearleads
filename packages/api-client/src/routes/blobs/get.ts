import { isBlobResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getBlob(request: RequestFn, blobId: string) {
  return request(`/blobs/${blobId}`, isBlobResponse, "GET");
}
