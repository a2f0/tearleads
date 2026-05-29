import type { ListDocumentAttachmentsResponse } from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import {
  BlobContentKeyBundleError,
  getLatestCurrentBlobContentKeyBundle,
} from "../../access/read/blobContentKeyStore";
import {
  BlobKekTargetError,
  resolveCurrentBlobKekTargets,
} from "../../access/read/blobKekTargets";
import type { DatabaseSession } from "../../adapters/postgres";
import { attachmentBindings } from "../../schema";
import { toContentKeyBundleResponse } from "../blobs/mutations/records";
import {
  KeyingReadAccessError,
  resolveReadableDocumentAccess,
} from "../keyingReadAccess";

interface ListDocumentAttachmentsWorkflowInput {
  documentId: string;
  userId: string;
}

export class ListDocumentAttachmentsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export async function runListDocumentAttachmentsWorkflow(
  executor: DatabaseSession,
  input: ListDocumentAttachmentsWorkflowInput,
): Promise<ListDocumentAttachmentsResponse> {
  try {
    await resolveReadableDocumentAccess({
      documentId: input.documentId,
      executor,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof KeyingReadAccessError) {
      throw new ListDocumentAttachmentsError(error.message, error.status);
    }
    throw error;
  }

  const rows = await executor
    .select({
      bindingId: attachmentBindings.id,
      blobId: attachmentBindings.blobId,
      slotId: attachmentBindings.slotId,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, input.documentId),
        isNull(attachmentBindings.detachedAt),
      ),
    );

  const contentKeyBundleByBlobId = new Map<
    string,
    Awaited<ReturnType<typeof getLatestCurrentBlobContentKeyBundle>>
  >();
  for (const blobId of [...new Set(rows.map((row) => row.blobId))].sort()) {
    try {
      const currentTargets = await resolveCurrentBlobKekTargets(
        blobId,
        executor,
      );
      contentKeyBundleByBlobId.set(
        blobId,
        await getLatestCurrentBlobContentKeyBundle(
          { blobId, currentTargets },
          executor,
        ),
      );
    } catch (error) {
      if (
        error instanceof BlobKekTargetError ||
        error instanceof BlobContentKeyBundleError
      ) {
        throw new ListDocumentAttachmentsError(error.message, error.status);
      }
      throw error;
    }
  }

  return rows.map((row) => {
    const contentKeyBundle = contentKeyBundleByBlobId.get(row.blobId);
    if (!contentKeyBundle) {
      throw new ListDocumentAttachmentsError(
        "Blob content-key bundle missing",
        409,
      );
    }

    return {
      bindingId: row.bindingId,
      blobId: row.blobId,
      contentKeyBundle: toContentKeyBundleResponse(contentKeyBundle),
      slotId: row.slotId,
    };
  });
}
