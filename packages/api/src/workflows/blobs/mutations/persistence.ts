import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobStages,
  blobs,
} from "@tearleads/api-shared/schema";
import type {
  VerifiedAttachmentBinding,
  VerifiedAttachmentDetach,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { appendDocumentAttachmentAuditEntries } from "../../../documents/documentAttachmentAuditEvents";
import { documentAuditAccessFromManifest } from "../../../documents/documentAuditAccess";
import {
  lockRowForUpdate,
  nowExpression,
  wallClockNowExpression,
} from "../../../utils/sqlDialect";
import { loadOwnedActiveBlobStage } from "../stageAccess";
import { assertStoredBlobOrganizationMatches } from "./authorization";
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
  // FOR UPDATE on the existing blob row serializes this bind against the blob GC
  // sweep, which locks the same row before hard-deleting a dereferenced blob.
  // Holding the lock before the binding insert below means a concurrent reclaim
  // either blocks until this bind commits (and then sees the blob referenced and
  // revives it) or commits first (and this query then finds the blob gone and
  // fails closed) — so a bind can never re-reference a blob being reclaimed.
  const lockQuery = input.executor
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);
  const [blob] = await lockRowForUpdate(lockQuery);
  if (!blob) {
    throw new BlobMutationError("Blob not found", 404);
  }
}

export async function promoteStagedBlobIfPresent(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
  readonly expectedOrganizationId: string;
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

  // Blob ids are generation identifiers. Once an id appears in immutable
  // audit history it may not be promoted again, even after live-state pruning:
  // a pending object-deletion work item for the old generation must never be
  // able to target a newly uploaded object with the same id. Retained ownership
  // lets us conceal historical ids from every other organization.
  const [auditedBlob] = await input.executor
    .select({
      blobId: blobAuditObjects.blobId,
      organizationId: blobAuditObjects.organizationId,
    })
    .from(blobAuditObjects)
    .where(eq(blobAuditObjects.blobId, input.blobId))
    .limit(1);
  if (auditedBlob) {
    if (auditedBlob.organizationId !== input.expectedOrganizationId) {
      throw new BlobMutationError("Blob not found", 404);
    }
    throw new BlobMutationError("Blob already exists", 409);
  }

  const [existingBlob] = await input.executor
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);
  if (existingBlob) {
    throw new BlobMutationError("Blob already exists", 409);
  }

  const stage = await loadOwnedActiveBlobStage(input.executor, {
    error: (message, status) => new BlobMutationError(message, status),
    lockForUpdate: true,
    stageId: input.request.stagedBlob.stageId,
    userId: input.userId,
  });

  if (stage.completedAt === null) {
    throw new BlobMutationError("Blob multipart stage is not complete", 409);
  }
  if (
    !input.prevalidatedMultipartStage ||
    input.prevalidatedMultipartStage.stageId !== stage.id ||
    input.prevalidatedMultipartStage.storageKey !== stage.storageKey ||
    input.prevalidatedMultipartStage.byteLength !== stage.byteLength ||
    input.prevalidatedMultipartStage.sha256 !== stage.sha256
  ) {
    throw new BlobMutationError(
      "Blob multipart stage prevalidation is stale",
      409,
    );
  }

  const [inserted] = await input.executor
    .insert(blobs)
    .values({
      id: input.blobId,
      byteLength: stage.byteLength,
      sha256: stage.sha256,
      storageKey: stage.storageKey,
    })
    .onConflictDoNothing({ target: blobs.id })
    .returning({ id: blobs.id });
  if (!inserted) {
    // ON CONFLICT keeps PostgreSQL's transaction usable after a concurrent
    // promotion wins. Re-read the committed winner so foreign ids retain the
    // same concealed response as blobs that existed before this transaction.
    await assertStoredBlobOrganizationMatches({
      blobId: input.blobId,
      executor: input.executor,
      expectedOrganizationId: input.expectedOrganizationId,
    });
    throw new BlobMutationError("Blob already exists", 409);
  }
  await input.executor.delete(blobStages).where(eq(blobStages.id, stage.id));

  return { sha256: stage.sha256 };
}

// Clear a prior purge's soft-delete marker when a blob is (re)bound: the blob
// is referenced again, so it must not be reclaimed by the GC sweep. Idempotent —
// a no-op for a live (never-dereferenced) blob. This, together with retained
// bytes on the purge side, makes a purge/bind race on a shared blob safe.
export async function reviveBlobIfDereferenced(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  await input.executor
    .update(blobs)
    .set({ dereferencedAt: null, reclaimAttemptedAt: null })
    .where(and(eq(blobs.id, input.blobId), isNotNull(blobs.dereferencedAt)));
}

/**
 * Start the delayed-reclamation clock when a detach or replacement removes the
 * final active reference to a blob. Detached bindings and audit events preserve
 * history metadata, but neither keeps live bytes or key material reachable.
 *
 * Locking the blob row serializes this decision against bind and GC, which lock
 * the same row. A concurrent bind therefore either becomes visible to the
 * active-reference check or runs afterward and clears `dereferencedAt`.
 */
export async function markBlobDereferencedIfInactive(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const lockQuery = input.executor
    .select({ id: blobs.id })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);
  const [blob] = await lockRowForUpdate(lockQuery);
  if (!blob) {
    throw new BlobMutationError("Blob not found", 404);
  }

  const [activeBinding] = await input.executor
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.blobId, input.blobId),
        isNull(attachmentBindings.detachedAt),
      ),
    )
    .limit(1);
  if (activeBinding) {
    return;
  }

  await input.executor
    .update(blobs)
    .set({
      dereferencedAt: wallClockNowExpression(),
      reclaimAttemptedAt: null,
    })
    .where(and(eq(blobs.id, input.blobId), isNull(blobs.dereferencedAt)));
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
    .set({ detachedAt: nowExpression() })
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
    organizationId: input.manifest.state.organizationId,
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
    organizationId: input.manifest.state.organizationId,
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
