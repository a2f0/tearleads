import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import { attachmentBindings } from "@symcrypt/api-shared/schema";
import type {
  VerifiedAttachmentBinding,
  VerifiedAttachmentDetach,
} from "@symcrypt/crypto";
import { and, eq, isNull } from "drizzle-orm";
import { nowExpression } from "../../../utils/sqlDialect";
import { storeVerifiedAccessEventInTransaction } from "./accessManifestStore";

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
  executor: DatabaseSession,
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
  database: ApiDatabase,
): Promise<typeof attachmentBindings.$inferSelect> {
  return database.transaction((tx) =>
    storeVerifiedAttachmentBindingInTransaction(binding, tx),
  );
}

export async function storeVerifiedAttachmentBindingInTransaction(
  binding: VerifiedAttachmentBinding,
  executor: DatabaseTransaction,
): Promise<typeof attachmentBindings.$inferSelect> {
  await storeVerifiedAccessEventInTransaction(binding.event, executor);
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
  database: ApiDatabase,
): Promise<typeof attachmentBindings.$inferSelect> {
  return database.transaction((tx) =>
    storeVerifiedAttachmentDetachInTransaction(detach, tx),
  );
}

export async function storeVerifiedAttachmentDetachInTransaction(
  detach: VerifiedAttachmentDetach,
  executor: DatabaseTransaction,
): Promise<typeof attachmentBindings.$inferSelect> {
  await storeVerifiedAccessEventInTransaction(detach.event, executor);
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
    .set({ detachedAt: nowExpression() })
    .where(
      and(
        eq(attachmentBindings.id, detach.bindingId),
        isNull(attachmentBindings.detachedAt),
      ),
    )
    .returning();

  if (detachedRow) {
    return detachedRow;
  }

  const updatedRow = await loadAttachmentBindingRow(detach.bindingId, executor);
  if (updatedRow) {
    return updatedRow;
  }

  throw new AttachmentBindingProjectionError(
    "Failed to detach attachment binding projection",
    409,
  );
}
