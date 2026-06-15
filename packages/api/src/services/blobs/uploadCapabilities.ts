import type { BlobUploadCapabilitiesResponse } from "@tearleads/validators/response";
import type { ApiServiceRuntime } from "../runtime";

export function getBlobUploadCapabilities(
  runtime: ApiServiceRuntime,
): BlobUploadCapabilitiesResponse {
  const durableMultipart = runtime.blobObjectStoreKind === "s3";

  return {
    multipart: {
      durable: durableMultipart,
      enabled: durableMultipart,
    },
  };
}
