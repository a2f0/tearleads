import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  containerDocumentSyncTombstones,
  containerMetadataDocuments,
  containers,
  documents,
} from "@tearleads/api-shared/schema";
import type { VerifiedDocumentLinkSetManifest } from "@tearleads/crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  getCurrentAccessManifestHead,
  getStoredAccessEventByObjectType,
} from "../../../../access/read/accessManifestStore";
import { uniqueSortedStrings } from "../../../../utils/array";
import { isUniqueViolation } from "../../../../utils/databaseErrors";
import {
  DocumentMutationError,
  documentManifestAlreadyExists,
  documentNotFound,
} from "../errors";

/**
 * Insert the document row. The links themselves are the stored manifest's
 * link projection under its head; the caller touches the linked containers
 * just before commit, so their rows are not held through the create.
 */
export async function insertDocumentRow(input: {
  readonly createdByFingerprint: string;
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}) {
  const updatedAt = new Date();
  let inserted: typeof documents.$inferSelect | undefined;
  try {
    [inserted] = await input.executor
      .insert(documents)
      .values({
        id: input.manifest.state.documentId,
        createdByFingerprint: input.createdByFingerprint,
        updatedAt,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent create with the same client-chosen id committed between
      // assertCreateCanAdvanceDocumentHead and this insert. Report the same
      // conflict the sequential path gives so the caller adopts the existing
      // remote document instead of failing on a driver 500.
      throw documentManifestAlreadyExists();
    }
    throw error;
  }
  if (!inserted) {
    throw new DocumentMutationError("Failed to create document", 409);
  }

  return inserted;
}

export async function assertCreateCanAdvanceDocumentHead(
  executor: DatabaseTransaction,
  documentId: string,
  linkedContainerIds: readonly string[],
): Promise<void> {
  const [metadataBinding] = await executor
    .select({
      containerId: containerMetadataDocuments.containerId,
      liveContainerId: containers.id,
    })
    .from(containerMetadataDocuments)
    .leftJoin(
      containers,
      eq(containers.id, containerMetadataDocuments.containerId),
    )
    .where(eq(containerMetadataDocuments.documentId, documentId))
    .limit(1);
  if (metadataBinding && metadataBinding.liveContainerId === null) {
    throw new DocumentMutationError(
      "Document ID belongs to a deleted container",
      409,
    );
  }

  if (
    metadataBinding &&
    (linkedContainerIds.length !== 1 ||
      linkedContainerIds[0] !== metadataBinding.containerId)
  ) {
    throw new DocumentMutationError(
      "Container metadata document must link only to its owning container",
      409,
    );
  }

  const purgeEvent = await getStoredAccessEventByObjectType({
    eventType: "document.purge",
    executor,
    objectId: documentId,
    objectKind: "document",
  });
  if (purgeEvent) {
    throw new DocumentMutationError("Document was permanently purged", 409);
  }

  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );
  if (head) {
    throw documentManifestAlreadyExists();
  }
}

export async function assertDocumentLinkSetCanAdvance(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedDocumentLinkSetManifest;
  readonly previousManifest: VerifiedDocumentLinkSetManifest;
}): Promise<void> {
  if (
    input.manifest.state.documentId !== input.documentId ||
    input.previousManifest.state.documentId !== input.documentId
  ) {
    throw new DocumentMutationError("Document id mismatch", 400);
  }

  const currentHead = await getCurrentAccessManifestHead(
    "document",
    input.documentId,
    input.executor,
  );
  if (!currentHead) {
    throw new DocumentMutationError("Document manifest head missing", 404);
  }
  if (currentHead.manifestHash !== input.previousManifest.manifestHash) {
    throw new DocumentMutationError("Document manifest is stale", 409);
  }
}

export async function assertDocumentCanRelink(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  await ensureDocumentExists({
    documentId: input.documentId,
    executor: input.executor,
  });

  const [metadataBinding] = await input.executor
    .select({ documentId: containerMetadataDocuments.documentId })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.documentId, input.documentId))
    .limit(1);

  if (metadataBinding) {
    throw new DocumentMutationError(
      "Container metadata documents cannot be structurally relinked",
      409,
    );
  }
}

/**
 * Record a link-set change whose manifest the caller stored as the new head
 * over `previousLinkedContainerIds` (the verified previous head's set): write
 * discovery tombstones for removed containers and touch every affected row.
 */
export async function recordDocumentLinkSetChange(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly incrementAttributionRevision?: boolean;
  readonly linkedContainerIds: readonly string[];
  readonly previousLinkedContainerIds: readonly string[];
}): Promise<void> {
  const previousContainerIds = uniqueSortedStrings(
    input.previousLinkedContainerIds,
  );
  const nextContainerIds = uniqueSortedStrings(input.linkedContainerIds);
  const removedContainerIds = previousContainerIds.filter(
    (containerId) => !nextContainerIds.includes(containerId),
  );
  const updatedAt = new Date();

  if (removedContainerIds.length > 0) {
    await input.executor
      .insert(containerDocumentSyncTombstones)
      .values(
        removedContainerIds.map((containerId) => ({
          containerId,
          documentId: input.documentId,
          updatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [
          containerDocumentSyncTombstones.containerId,
          containerDocumentSyncTombstones.documentId,
        ],
        set: { updatedAt },
      });
  }

  await touchDocumentAndLinkedContainers(input.executor, {
    documentId: input.documentId,
    ...(input.incrementAttributionRevision
      ? { incrementAttributionRevision: true }
      : {}),
    linkedContainerIds: [...previousContainerIds, ...nextContainerIds],
    updatedAt,
  });
}

export async function ensureDocumentExists(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const [document] = await input.executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document) {
    // The documents row is the authoritative existence signal, so this is the
    // one place the sync path may emit the coded wipe-authorizing 404.
    throw documentNotFound();
  }
}

export async function touchContainers(
  executor: DatabaseTransaction,
  containerIds: readonly string[],
  updatedAt = new Date(),
): Promise<void> {
  const uniqueContainerIds = [...new Set(containerIds)];
  if (uniqueContainerIds.length === 0) {
    return;
  }

  await executor
    .update(containers)
    .set({ updatedAt })
    .where(inArray(containers.id, uniqueContainerIds));
}

export async function touchDocumentAndLinkedContainers(
  executor: DatabaseTransaction,
  input: {
    readonly documentId: string;
    readonly incrementAttributionRevision?: boolean;
    readonly linkedContainerIds: readonly string[];
    readonly updatedAt?: Date;
  },
): Promise<void> {
  const updatedAt = input.updatedAt ?? new Date();
  await executor
    .update(documents)
    .set({
      ...(input.incrementAttributionRevision
        ? {
            attributionRevision: sql`${documents.attributionRevision} + 1`,
          }
        : {}),
      updatedAt,
    })
    .where(eq(documents.id, input.documentId));
  await touchContainers(executor, input.linkedContainerIds, updatedAt);
}
