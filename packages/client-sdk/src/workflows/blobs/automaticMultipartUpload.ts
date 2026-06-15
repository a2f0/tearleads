import type {
  BlobAttachmentApi,
  UploadDocumentAttachmentInput,
} from "../../data/documents/blob/shared/types";

export type MultipartBlobAttachmentApi = BlobAttachmentApi &
  Required<
    Pick<
      BlobAttachmentApi,
      | "completeMultipartBlobStage"
      | "getMultipartBlobStage"
      | "initiateMultipartBlobStage"
      | "uploadMultipartBlobPart"
    >
  >;

const DEFAULT_AUTOMATIC_MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
const DEFAULT_AUTOMATIC_MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;

function assertMultipartBlobAttachmentApi(
  apiClient: BlobAttachmentApi,
): asserts apiClient is MultipartBlobAttachmentApi {
  if (
    typeof apiClient.completeMultipartBlobStage !== "function" ||
    typeof apiClient.getMultipartBlobStage !== "function" ||
    typeof apiClient.initiateMultipartBlobStage !== "function" ||
    typeof apiClient.uploadMultipartBlobPart !== "function"
  ) {
    throw new Error("Multipart blob upload API is unavailable");
  }
}

export function requireMultipartBlobAttachmentApi(
  apiClient: BlobAttachmentApi,
): MultipartBlobAttachmentApi {
  assertMultipartBlobAttachmentApi(apiClient);
  return apiClient;
}

function isMultipartBlobAttachmentApi(
  apiClient: BlobAttachmentApi,
): apiClient is MultipartBlobAttachmentApi {
  return (
    typeof apiClient.completeMultipartBlobStage === "function" &&
    typeof apiClient.getMultipartBlobStage === "function" &&
    typeof apiClient.initiateMultipartBlobStage === "function" &&
    typeof apiClient.uploadMultipartBlobPart === "function"
  );
}

export async function resolveMultipartUploadOptions(input: {
  readonly apiClient: BlobAttachmentApi;
  readonly encryptedByteLength: number;
  readonly multipart: UploadDocumentAttachmentInput["multipart"];
}): Promise<UploadDocumentAttachmentInput["multipart"]> {
  if (input.multipart !== undefined) {
    return input.multipart;
  }
  if (
    input.encryptedByteLength < DEFAULT_AUTOMATIC_MULTIPART_THRESHOLD_BYTES ||
    !input.apiClient.getBlobUploadCapabilities ||
    !isMultipartBlobAttachmentApi(input.apiClient)
  ) {
    return undefined;
  }

  let capabilities: Awaited<
    ReturnType<NonNullable<BlobAttachmentApi["getBlobUploadCapabilities"]>>
  >;
  try {
    capabilities = await input.apiClient.getBlobUploadCapabilities();
  } catch {
    return undefined;
  }

  if (
    !capabilities ||
    !capabilities.multipart.enabled ||
    !capabilities.multipart.durable
  ) {
    return undefined;
  }

  return {
    partSize: DEFAULT_AUTOMATIC_MULTIPART_PART_SIZE_BYTES,
  };
}
