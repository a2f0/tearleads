import { bytesToHex, createIncrementalSha256 } from "@tearleads/crypto";
import {
  type BlobByteSourceInput,
  createBlobByteSource,
} from "../blobContracts";

/** Kept inside encrypted document content; independent of upload encryption/retries. */
export async function attachmentContentSha256(
  input: BlobByteSourceInput,
): Promise<string> {
  const source = createBlobByteSource(input);
  const hash = createIncrementalSha256();
  const chunkSize = 5 * 1024 * 1024;
  for (let offset = 0; offset < source.byteLength; offset += chunkSize) {
    const length = Math.min(chunkSize, source.byteLength - offset);
    const bytes = await source.read(offset, length);
    if (bytes.byteLength !== length)
      throw new Error("Attachment source returned an unexpected byte length");
    hash.update(bytes);
  }
  return bytesToHex(hash.digest());
}
