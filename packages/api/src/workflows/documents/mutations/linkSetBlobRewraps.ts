import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { attachmentBindings } from "@tearleads/api-shared/schema";
import type { DocumentLinkAccessEventBody } from "@tearleads/crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  BlobContentKeyBundleError,
  rewrapDocumentBlobContentKeyInTransaction,
} from "../../../access/write/blobContentKeyStore";
import { lockBlobMutationRows } from "../../blobs/mutations/blobMutationLocks";
import { DocumentMutationError } from "./errors";

type BlobRewraps = DocumentLinkAccessEventBody["blobRewraps"];

/** The exclusive document head precedes these blob locks, as in attachment bind. */
export async function lockDocumentLinkBlobRewraps(input: {
  documentId: string;
  executor: DatabaseTransaction;
  rewraps: BlobRewraps;
}): Promise<void> {
  const bindings = await input.executor
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, input.documentId),
        isNull(attachmentBindings.detachedAt),
      ),
    );
  const expected = [
    ...new Set(bindings.map((binding) => binding.blobId)),
  ].sort();
  const actual = input.rewraps.map((rewrap) => rewrap.blobId).sort();
  if (
    expected.length !== actual.length ||
    expected.some((blobId, index) => actual[index] !== blobId)
  ) {
    throw new DocumentMutationError(
      "Document attachments changed; retry the link with current blob keys",
      409,
    );
  }
  await lockBlobMutationRows({ blobIds: expected, executor: input.executor });
}

export async function applyDocumentLinkBlobRewraps(input: {
  documentId: string;
  executor: DatabaseTransaction;
  rewraps: BlobRewraps;
}): Promise<void> {
  for (const rewrap of input.rewraps) {
    try {
      await rewrapDocumentBlobContentKeyInTransaction(
        { documentId: input.documentId, rewrap },
        input.executor,
      );
    } catch (error) {
      if (error instanceof BlobContentKeyBundleError)
        throw new DocumentMutationError(
          error.message,
          error.status === 404 ? 409 : error.status,
        );
      throw error;
    }
  }
}
