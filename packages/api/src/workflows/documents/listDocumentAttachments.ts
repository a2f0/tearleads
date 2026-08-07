import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import { attachmentBindings } from "@tearleads/api-shared/schema";
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
import { uniqueSortedStrings } from "../../utils/array";
import { toContentKeyBundleResponse } from "../blobs/mutations/records";
import {
  KeyingReadAccessError,
  resolveReadableDocumentAccess,
} from "../keyingReadAccess";

interface ListDocumentAttachmentsWorkflowInput {
  documentId: string;
  userId: string;
}

type CurrentBlobContentKeyBundle = Awaited<
  ReturnType<typeof getLatestCurrentBlobContentKeyBundle>
>;

interface BlobContentKeyBundleEntry {
  readonly blobId: string;
  readonly contentKeyBundle: CurrentBlobContentKeyBundle;
}

export class ListDocumentAttachmentsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

async function loadCurrentBlobContentKeyBundleEntry(
  blobId: string,
  executor: DatabaseSession,
): Promise<BlobContentKeyBundleEntry> {
  try {
    const currentTargets = await resolveCurrentBlobKekTargets(blobId, executor);
    const contentKeyBundle = await getLatestCurrentBlobContentKeyBundle(
      { blobId, currentTargets },
      executor,
    );
    return { blobId, contentKeyBundle };
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

  const contentKeyBundleEntries = await gatherWithExecutor(
    executor,
    uniqueSortedStrings(rows.map((row) => row.blobId)),
    (blobId) => loadCurrentBlobContentKeyBundleEntry(blobId, executor),
  );
  const contentKeyBundleByBlobId = new Map<
    string,
    CurrentBlobContentKeyBundle
  >();
  for (const entry of contentKeyBundleEntries) {
    contentKeyBundleByBlobId.set(entry.blobId, entry.contentKeyBundle);
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
