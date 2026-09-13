import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { listBlobContentWriteHeaders } from "../../../access/read/blobContentKeyStore";
import {
  KeyingReadAccessError,
  resolveReadableBlobAccess,
} from "../../keyingReadAccess";
import { BlobMutationError } from "./types";

/** Called with the blob and its current authorization heads locked, before binding. */
export async function assertExistingBlobSourceAuthority(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
  readonly userId: string;
}): Promise<void> {
  const stored = (
    await listBlobContentWriteHeaders([input.blobId], input.executor)
  ).get(input.blobId);
  // The verified ciphertext author retains source authority for their own bytes.
  // Other callers need current read access through an existing binding.
  if (stored?.header.writerUserId === input.userId) return;
  try {
    await resolveReadableBlobAccess(input);
  } catch (error) {
    if (error instanceof KeyingReadAccessError) {
      throw new BlobMutationError(error.message, error.status);
    }
    throw error;
  }
}
