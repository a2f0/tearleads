import type {
  VerifiedAttachmentBinding,
  VerifiedAttachmentDetach,
} from "@tearleads/crypto";
import { and, eq, isNull } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../../adapters/postgres";
import { attachmentBindings } from "../../schema";
import { storeVerifiedAccessEvent } from "./accessManifestStore";

type AttachmentBindingStoreExecutor = DatabaseExecutor;

class AttachmentBindingProjectionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "AttachmentBindingProjectionError";
  }
}

function assertStoredBindingMatches(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly row: typeof attachmentBindings.$inferSelect;
}): void {
  if (
    input.row.documentId !== input.binding.documentId ||
    input.row.slotId !== input.binding.slotId ||
    input.row.blobId !== input.binding.blobId ||
    input.row.previousBindingId !== input.binding.body.expectedBindingId ||
    input.row.attachmentEventHash !== input.binding.event.eventHash ||
    input.row.documentManifestHash !== input.binding.documentManifestHash
  ) {
    throw new AttachmentBindingProjectionError(
      "Attachment binding projection conflict",
      409,
    );
  }
}

async function loadAttachmentBindingRow(
  bindingId: string,
  executor: AttachmentBindingStoreExecutor,
) {
  const [row] = await executor
    .select()
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, bindingId))
    .limit(1);

  return row ?? null;
}

export async function storeVerifiedAttachmentBinding(
  binding: VerifiedAttachmentBinding,
  executor: AttachmentBindingStoreExecutor = db,
): Promise<typeof attachmentBindings.$inferSelect> {
  if (executor === db) {
    return db.transaction((tx) => storeVerifiedAttachmentBinding(binding, tx));
  }

  await storeVerifiedAccessEvent(binding.event, executor);
  const [insertedRow] = await executor
    .insert(attachmentBindings)
    .values({
      id: binding.bindingId,
      documentId: binding.documentId,
      slotId: binding.slotId,
      blobId: binding.blobId,
      previousBindingId: binding.body.expectedBindingId,
      attachmentEventHash: binding.event.eventHash,
      documentManifestHash: binding.documentManifestHash,
    })
    .onConflictDoNothing({ target: attachmentBindings.id })
    .returning();

  const row =
    insertedRow ??
    (await loadAttachmentBindingRow(binding.bindingId, executor));
  if (!row) {
    throw new AttachmentBindingProjectionError(
      "Failed to load attachment binding projection",
      409,
    );
  }

  assertStoredBindingMatches({ binding, row });
  return row;
}

export async function storeVerifiedAttachmentDetach(
  detach: VerifiedAttachmentDetach,
  executor: AttachmentBindingStoreExecutor = db,
): Promise<typeof attachmentBindings.$inferSelect> {
  if (executor === db) {
    return db.transaction((tx) => storeVerifiedAttachmentDetach(detach, tx));
  }

  await storeVerifiedAccessEvent(detach.event, executor);
  const row = await loadAttachmentBindingRow(detach.bindingId, executor);
  if (!row) {
    throw new AttachmentBindingProjectionError(
      "Attachment binding projection missing",
      404,
    );
  }

  if (
    row.documentId !== detach.documentId ||
    row.slotId !== detach.slotId ||
    row.blobId !== detach.blobId
  ) {
    throw new AttachmentBindingProjectionError(
      "Attachment detach projection does not match binding",
      409,
    );
  }

  if (row.detachedAt !== null) {
    return row;
  }

  const [detachedRow] = await executor
    .update(attachmentBindings)
    .set({ detachedAt: new Date() })
    .where(
      and(
        eq(attachmentBindings.id, detach.bindingId),
        isNull(attachmentBindings.detachedAt),
      ),
    )
    .returning();

  if (!detachedRow) {
    const updatedRow = await loadAttachmentBindingRow(
      detach.bindingId,
      executor,
    );
    if (updatedRow) {
      return updatedRow;
    }
  }

  if (!detachedRow) {
    throw new AttachmentBindingProjectionError(
      "Failed to detach attachment binding projection",
      409,
    );
  }

  return detachedRow;
}
