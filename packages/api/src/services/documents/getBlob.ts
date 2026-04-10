import { replaceBlobEnvelopeRecipients } from "@tearleads/crypto";
import type { BlobResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  canReadBlobAccess,
  listBlobRecipientEnvelopes,
  resolveBlobAccessState,
} from "../../access/blobAccess";
import { blobs } from "../../schema";
import { sha256Hex } from "../../utils/sha256";
import type { ApiServiceRuntime } from "../runtime";

interface GetBlobInput {
  blobId: string;
  userId: string;
}

export class GetBlobError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404,
  ) {
    super(message);
  }
}

export async function getBlob(
  runtime: ApiServiceRuntime,
  input: GetBlobInput,
): Promise<BlobResponse> {
  const access = await resolveBlobAccessState(input.blobId, runtime.db);
  if (!access) {
    throw new GetBlobError("Blob not found", 404);
  }

  if (!canReadBlobAccess(access, input.userId)) {
    throw new GetBlobError("Forbidden", 403);
  }

  const [row] = await runtime.db
    .select({
      blobId: blobs.id,
      encryptedBytes: blobs.encryptedBytes,
      sha256: blobs.sha256,
    })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);

  if (!row) {
    throw new GetBlobError("Blob not found", 404);
  }

  const currentRecipientEnvelopes = await listBlobRecipientEnvelopes(
    input.blobId,
    access.currentAccessEpoch,
    runtime.db,
  );
  const encryptedBytes = currentRecipientEnvelopes
    ? replaceBlobEnvelopeRecipients(
        row.encryptedBytes,
        currentRecipientEnvelopes,
      )
    : row.encryptedBytes;

  return {
    blobId: row.blobId,
    encryptedBytes,
    sha256:
      encryptedBytes === row.encryptedBytes
        ? row.sha256
        : await sha256Hex(encryptedBytes),
  };
}
