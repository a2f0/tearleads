import type { ListDocumentAttachmentsResponse } from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import {
  canReadDocumentAccess,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import { attachmentBindings } from "../../schema";
import type { ApiServiceRuntime } from "../runtime";

interface ListDocumentAttachmentsInput {
  documentId: string;
  userId: string;
}

export class ListDocumentAttachmentsError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404,
  ) {
    super(message);
  }
}

export async function listDocumentAttachments(
  runtime: ApiServiceRuntime,
  input: ListDocumentAttachmentsInput,
): Promise<ListDocumentAttachmentsResponse> {
  const access = await resolveDocumentAccessState(input.documentId, runtime.db);
  if (!access) {
    throw new ListDocumentAttachmentsError("Document not found", 404);
  }

  if (!canReadDocumentAccess(access, input.userId)) {
    throw new ListDocumentAttachmentsError("Forbidden", 403);
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
