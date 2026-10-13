import { type S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { BlobObjectStore } from "./blobObjectStore";

export function createS3BlobUploadUrl(input: {
  readonly bucket: string;
  readonly client: S3Client;
}): NonNullable<BlobObjectStore["createUploadPartUrl"]> {
  return async ({
    key,
    uploadId,
    partNumber,
    byteLength,
    contentMd5,
    expiresIn,
  }) => {
    const signingDate = new Date(Math.floor(Date.now() / 1000) * 1000);
    const url = await getSignedUrl(
      input.client,
      new UploadPartCommand({
        Bucket: input.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        ContentLength: byteLength,
        // R2 accepts Content-MD5 on UploadPart, not flexible SHA-256 checksums.
        // Both this header and the implicit File body length are signed.
        ContentMD5: contentMd5,
      }),
      { expiresIn, signingDate },
    );
    return {
      expiresAt: new Date(
        signingDate.getTime() + expiresIn * 1000,
      ).toISOString(),
      url,
    };
  };
}
