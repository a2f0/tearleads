import type { ListDocumentAttachmentsResponse } from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import { attachmentBindings } from "../../schema";
import {
  KeyingReadAccessError,
  resolveReadableDocumentAccess,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";

interface ListDocumentAttachmentsInput {
  documentId: string;
  userId: string;
}

export class ListDocumentAttachmentsError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
  }
}

export async function listDocumentAttachments(
  runtime: ApiServiceRuntime,
  input: ListDocumentAttachmentsInput,
): Promise<ListDocumentAttachmentsResponse> {
  try {
    await resolveReadableDocumentAccess({
      documentId: input.documentId,
      executor: runtime.db,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof KeyingReadAccessError) {
      throw new ListDocumentAttachmentsError(error.message, error.status);
    }
    throw error;
  }

  const rows = await runtime.db
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

  return rows.map((row) => ({
    bindingId: row.bindingId,
    blobId: row.blobId,
    slotId: row.slotId,
  }));
}
