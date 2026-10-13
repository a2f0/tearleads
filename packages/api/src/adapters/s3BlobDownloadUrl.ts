import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { BlobObjectStore } from "./blobObjectStore";

export function createS3BlobDownloadUrl(input: {
  readonly bucket: string;
  readonly client: S3Client;
}): NonNullable<BlobObjectStore["createDownloadUrl"]> {
  return async ({ key, expiresIn }) => {
    // SigV4 timestamps have second precision; report the actual signed expiry.
    const signingDate = new Date(Math.floor(Date.now() / 1000) * 1000);
    const url = await getSignedUrl(
      input.client,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: key,
        ResponseCacheControl: "no-store",
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
