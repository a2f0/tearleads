import {
  type BlobUploadCapabilitiesResponse,
  isBlobUploadCapabilitiesResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getBlobUploadCapabilities(
  request: RequestFn,
): Promise<BlobUploadCapabilitiesResponse | null> {
  return request(
    "/blobs/uploads/capabilities",
    isBlobUploadCapabilitiesResponse,
    "GET",
  );
}
