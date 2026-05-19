import type {
  VerifiedAttachmentBinding,
  VerifiedAttachmentDetach,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../../../adapters/postgres";
import { appendDocumentAttachmentAuditEntries } from "../../../documents/documentAttachmentAuditEvents";
import { documentAuditAccessFromManifest } from "../../../documents/documentAuditAccess";
import { attachmentBindings, blobStages, blobs } from "../../../schema";
import {
  encodeExternalBlobBytesRef,
  readMultipartBlobStageRecord,
} from "../../../utils/blobStageRecords";
import {
  BlobMutationError,
  type PrevalidatedMultipartBlobStage,
} from "./types";

type ActiveAttachmentBindingRow = Awaited<
  ReturnType<typeof loadActiveAttachmentBindingsForSlot>
>[number];

async function loadActiveAttachmentBindingsForSlot(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly slotId: string;
}) {
  return input.executor
    .select({
      blobId: attachmentBindings.blobId,
      documentId: attachmentBindings.documentId,
      id: attachmentBindings.id,
      previousBindingId: attachmentBindings.previousBindingId,
      slotId: attachmentBindings.slotId,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, input.documentId),
        eq(attachmentBindings.slotId, input.slotId),
        isNull(attachmentBindings.detachedAt),
      ),
    );
}

export async function requireSingleActiveAttachmentBindingForSlot(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly slotId: string;
}): Promise<ActiveAttachmentBindingRow | null> {
  const rows = await loadActiveAttachmentBindingsForSlot(input);
  if (rows.length > 1) {
    throw new BlobMutationError(
      "Attachment slot has multiple active bindings",
      409,
    );
  }

  return rows[0] ?? null;
}

export async function loadActiveAttachmentBindingById(input: {
  readonly bindingId: string;
  readonly executor: DatabaseTransaction;
}) {
  const [binding] = await input.executor
    .select({
      blobId: attachmentBindings.blobId,
      documentId: attachmentBindings.documentId,
      id: attachmentBindings.id,
      previousBindingId: attachmentBindings.previousBindingId,
      slotId: attachmentBindings.slotId,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.id, input.bindingId),
        isNull(attachmentBindings.detachedAt),
      ),
    )
    .limit(1);

  return binding ?? null;
}

async function ensureBlobExists(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const [blob] = await input.executor
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);
  if (!blob) {
    throw new BlobMutationError("Blob not found", 404);
  }
}

export async function promoteStagedBlobIfPresent(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
  readonly prevalidatedMultipartStage: PrevalidatedMultipartBlobStage | null;
  readonly request: BlobAttachmentBindRequest;
  readonly userId: string;
}): Promise<{ readonly sha256: string } | null> {
  if (!input.request.stagedBlob) {
    await ensureBlobExists({
      blobId: input.blobId,
      executor: input.executor,
    });
    return null;
  }

  const [existingBlob] = await input.executor
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);
  if (existingBlob) {
    throw new BlobMutationError("Blob already exists", 409);
  }

  const [stage] = await input.executor
    .select({
      byteLength: blobStages.byteLength,
      encryptedBytes: blobStages.encryptedBytes,
      expiresAt: blobStages.expiresAt,
      id: blobStages.id,
      ownerUserId: blobStages.ownerUserId,
      sha256: blobStages.sha256,
    })
    .from(blobStages)
    .where(eq(blobStages.id, input.request.stagedBlob.stageId))
    .limit(1);

  if (!stage) {
    throw new BlobMutationError("Blob stage not found", 404);
  }
  if (stage.ownerUserId !== input.userId) {
    throw new BlobMutationError("Forbidden", 403);
  }
  if (stage.expiresAt.getTime() <= Date.now()) {
    throw new BlobMutationError("Blob stage has expired", 409);
  }

  const multipartStage = readMultipartBlobStageRecord(stage.encryptedBytes);
  if (multipartStage) {
    if (multipartStage.state !== "complete") {
      throw new BlobMutationError("Blob multipart stage is not complete", 409);
    }
    if (
      !input.prevalidatedMultipartStage ||
      input.prevalidatedMultipartStage.stageId !== stage.id ||
      input.prevalidatedMultipartStage.storageKey !==
        multipartStage.storageKey ||
      input.prevalidatedMultipartStage.byteLength !== stage.byteLength ||
      input.prevalidatedMultipartStage.sha256 !== stage.sha256
    ) {
      throw new BlobMutationError(
        "Blob multipart stage prevalidation is stale",
        409,
      );
    }

    await input.executor.insert(blobs).values({
      id: input.blobId,
      byteLength: stage.byteLength,
      encryptedBytes: encodeExternalBlobBytesRef({
        storageKey: multipartStage.storageKey,
      }),
      sha256: stage.sha256,
      storageKey: multipartStage.storageKey,
    });
    await input.executor.delete(blobStages).where(eq(blobStages.id, stage.id));

    return { sha256: stage.sha256 };
  }

  await input.executor.insert(blobs).values({
    id: input.blobId,
    byteLength: stage.byteLength,
    encryptedBytes: stage.encryptedBytes,
    sha256: stage.sha256,
    storageKey: stage.id,
  });
  await input.executor.delete(blobStages).where(eq(blobStages.id, stage.id));

  return { sha256: stage.sha256 };
}

export async function detachActiveSlotBinding(input: {
  readonly activeBinding: ActiveAttachmentBindingRow | null;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  if (!input.activeBinding) {
    return;
  }

  await input.executor
    .update(attachmentBindings)
    .set({ detachedAt: sql`now()` })
    .where(eq(attachmentBindings.id, input.activeBinding.id));
}

export async function appendAttachmentAuditEvent(input: {
  readonly activeBinding: ActiveAttachmentBindingRow | null;
  readonly binding: VerifiedAttachmentBinding;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly manifest: VerifiedDocumentLinkSetManifest;
  readonly userId: string;
}): Promise<void> {
  const auditAccess = await documentAuditAccessFromManifest(input.manifest);

  await appendDocumentAttachmentAuditEntries(input.executor, {
    ...auditAccess,
    actorFingerprint: input.fingerprint,
    actorUserId: input.userId,
    documentId: input.binding.documentId,
    events: [
      {
        action: input.activeBinding ? "replace" : "attach",
        bindingId: input.binding.bindingId,
        blobId: input.binding.blobId,
        previousBindingId: input.activeBinding?.id ?? null,
        previousBlobId: input.activeBinding?.blobId ?? null,
        slotId: input.binding.slotId,
      },
    ],
  });
}

export async function appendAttachmentDetachAuditEvent(input: {
  readonly detach: VerifiedAttachmentDetach;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly manifest: VerifiedDocumentLinkSetManifest;
  readonly userId: string;
}): Promise<void> {
  const auditAccess = await documentAuditAccessFromManifest(input.manifest);

  await appendDocumentAttachmentAuditEntries(input.executor, {
    ...auditAccess,
    actorFingerprint: input.fingerprint,
    actorUserId: input.userId,
    documentId: input.detach.documentId,
    events: [
      {
        action: "detach",
        bindingId: input.detach.bindingId,
        blobId: input.detach.blobId,
        previousBindingId: null,
        previousBlobId: null,
        slotId: input.detach.slotId,
      },
    ],
  });
}
