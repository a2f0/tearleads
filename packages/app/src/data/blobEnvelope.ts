import { decryptAsRecipient, parseBlobEnvelope } from "@tearleads/crypto";
import type { BlobBytes } from "./blob-store";

export { serializeBlobEnvelope } from "@tearleads/crypto";

export async function decryptBlobEnvelope(
  encryptedBytes: string,
  secretKey: Uint8Array,
): Promise<BlobBytes> {
  return decryptAsRecipient(parseBlobEnvelope(encryptedBytes), secretKey);
}
