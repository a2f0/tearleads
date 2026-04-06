import { parseEnvelope } from "@tearleads/loro";
import { createLoroRouter } from "@tearleads/loro/server";
import {
  isCommitDocumentChangeRequest,
  isStageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { validator } from "hono/validator";
import {
  canReadBlobAccess,
  refreshBlobAccesses,
  resolveBlobAccessState,
} from "../../access/blobAccess";
import {
  canWriteContainerAccess,
  resolveContainerAccessState,
} from "../../access/containerAccess";
import {
  canReadDocumentAccess,
  canWriteDocumentAccess,
  initializeDocumentAccess,
  listRecipientEncapsulationPublicKeys,
  listRecipientKeyFingerprints,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { publish } from "../../adapters/redisPubSub";
import { requireAuth } from "../../middleware/session";
import {
  attachmentBindings,
  blobStages,
  blobs,
  containers,
  documentContainerLinks,
  documents,
  documentUpdates,
} from "../../schema";
import { uniqueSortedStrings } from "../../utils/array";

function matchesRecipients(
  encryptedData: string,
  expectedRecipientKeyFingerprints: string[],
): boolean {
  const recipientKeyFingerprints = uniqueSortedStrings(
    parseEnvelope(encryptedData).recipients.map(
      (recipient) => recipient.keyFingerprint,
    ),
  );

  return (
    recipientKeyFingerprints.length ===
      expectedRecipientKeyFingerprints.length &&
    recipientKeyFingerprints.every(
      (fingerprint, index) =>
        fingerprint === expectedRecipientKeyFingerprints[index],
    )
  );
}

function hasDuplicateValues(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

class CommitChangeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 = 400,
  ) {
    super(message);
  }
}

class CreateDocumentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export const documentsRouter = createLoroRouter({
  store: {
    async createDocument(input) {
      const linkedContainerIds = uniqueSortedStrings(input.linkedContainerIds);

      if (input.linkedContainerIds.length !== linkedContainerIds.length) {
        throw new CreateDocumentError(
          "linkedContainerIds must not contain duplicates",
          400,
        );
      }

      return db.transaction(async (tx) => {
        const linkedContainers = await tx
          .select({
            id: containers.id,
            organizationId: containers.organizationId,
          })
          .from(containers)
          .where(inArray(containers.id, linkedContainerIds));

        if (linkedContainers.length !== linkedContainerIds.length) {
          throw new CreateDocumentError("Linked container not found", 404);
        }

        const organizationIds = uniqueSortedStrings(
          linkedContainers.map((container) => container.organizationId),
        );

        if (organizationIds.length !== 1) {
          throw new CreateDocumentError(
            "All linked containers must belong to the same organization",
            400,
          );
        }

        for (const container of linkedContainers) {
          const access = await resolveContainerAccessState(container.id, tx);

          if (!access) {
            throw new CreateDocumentError(
              "Linked container access state is unavailable",
              409,
            );
          }

          if (!canWriteContainerAccess(access, input.createdByUserId)) {
            throw new CreateDocumentError("Forbidden", 403);
          }
        }

        const [document] = await tx
          .insert(documents)
          .values({
            createdByFingerprint: input.createdByFingerprint,
          })
          .returning();
        if (!document) {
          return null;
        }

        await tx.insert(documentContainerLinks).values(
          linkedContainerIds.map((containerId) => ({
            documentId: document.id,
            containerId,
          })),
        );

        const currentAccessEpoch = await initializeDocumentAccess(
          document.id,
          tx,
        );
        const access = await resolveDocumentAccessState(document.id, tx);
        if (!access) {
          return null;
        }

        return {
          document,
          currentAccessEpoch,
          recipientEncapsulationPublicKeys:
            listRecipientEncapsulationPublicKeys(access),
        };
      });
    },
    async getDocumentById(documentId) {
      const [document] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, documentId));
      return document ?? null;
    },
    async getDocumentAccess({ documentId, userId }) {
      const access = await resolveDocumentAccessState(documentId);
      if (!access) {
        return null;
      }

      return {
        canRead: canReadDocumentAccess(access, userId),
        canWrite: canWriteDocumentAccess(access, userId),
        currentAccessEpoch: access.currentAccessEpoch,
        recipientKeyFingerprints: listRecipientKeyFingerprints(access),
        recipientEncapsulationPublicKeys:
          listRecipientEncapsulationPublicKeys(access),
      };
    },
    async appendDocumentUpdates({ documentId, authorFingerprint, updates }) {
      const acceptedUpdateIds: string[] = [];

      for (const update of updates) {
        const [existing] = await db
          .select({ id: documentUpdates.id })
          .from(documentUpdates)
          .where(eq(documentUpdates.id, update.id))
          .limit(1);

        if (existing) {
          acceptedUpdateIds.push(existing.id);
          continue;
        }

        const [inserted] = await db
          .insert(documentUpdates)
          .values({
            id: update.id,
            documentId,
            authorFingerprint,
            encryptedData: update.encryptedData,
            partialStartVersionVector: update.partialStartVersionVector,
            partialEndVersionVector: update.partialEndVersionVector,
          })
          .returning({ id: documentUpdates.id });

        if (inserted) {
          acceptedUpdateIds.push(inserted.id);
        }
      }

      return acceptedUpdateIds;
    },
    async listDocumentUpdates(documentId) {
      return db
        .select()
        .from(documentUpdates)
        .where(eq(documentUpdates.documentId, documentId))
        .orderBy(documentUpdates.sequence);
    },
  },
  publish,
  requireAuth,
});

documentsRouter.post(
  "/blobs/stage",
  requireAuth,
  validator("json", (value, c) => {
    if (!isStageBlobRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  }),
  async (c) => {
    const session = c.get("session");
    const { encryptedBytes, byteLength, sha256 } = c.req.valid("json");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const [stage] = await db
      .insert(blobStages)
      .values({
        ownerUserId: session.userId,
        encryptedBytes,
        byteLength,
        sha256,
        expiresAt,
      })
      .returning({ id: blobStages.id, expiresAt: blobStages.expiresAt });

    if (!stage) {
      return c.json({ error: "Failed to stage blob" }, 500);
    }

    return c.json({
      stageId: stage.id,
      expiresAt: stage.expiresAt.toISOString(),
    });
  },
);

documentsRouter.post(
  "/documents/:documentId/commit-change",
  requireAuth,
  validator("json", (value, c) => {
    if (!isCommitDocumentChangeRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  }),
  async (c) => {
    const documentId = c.req.param("documentId");
    const session = c.get("session");
    const { accessEpoch, attachmentCommits, attachmentDetaches, loroUpdate } =
      c.req.valid("json");

    const touchedSlotIds = [
      ...attachmentCommits.map((commit) => commit.slotId),
      ...attachmentDetaches.map((detach) => detach.slotId),
    ];
    if (hasDuplicateValues(touchedSlotIds)) {
      return c.json({ error: "Duplicate slotId in attachment mutations" }, 400);
    }

    const referencedSlotIds = loroUpdate?.referencedSlotIds ?? [];
    if (hasDuplicateValues(referencedSlotIds)) {
      return c.json(
        { error: "Duplicate slotId in loroUpdate references" },
        400,
      );
    }

    const document = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (document.length === 0) {
      return c.json({ error: "Document not found" }, 404);
    }

    const access = await resolveDocumentAccessState(documentId);
    if (!access) {
      return c.json({ error: "Document access state not found" }, 500);
    }

    if (!canWriteDocumentAccess(access, session.userId)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    if (accessEpoch !== access.currentAccessEpoch) {
      return c.json(
        {
          error: "Stale access epoch",
          currentAccessEpoch: access.currentAccessEpoch,
        },
        409,
      );
    }

    if (loroUpdate) {
      const expectedRecipientKeyFingerprints = uniqueSortedStrings(
        listRecipientKeyFingerprints(access),
      );

      try {
        if (
          !matchesRecipients(
            loroUpdate.encryptedData,
            expectedRecipientKeyFingerprints,
          )
        ) {
          return c.json({ error: "Encrypted update recipients mismatch" }, 400);
        }
      } catch {
        return c.json({ error: "Invalid encrypted update envelope" }, 400);
      }
    }

    try {
      const result = await db.transaction(async (tx) => {
        const activeBindingSlotIds = uniqueSortedStrings([
          ...touchedSlotIds,
          ...referencedSlotIds,
        ]);
        const activeBindings =
          activeBindingSlotIds.length === 0
            ? []
            : await tx
                .select({
                  id: attachmentBindings.id,
                  slotId: attachmentBindings.slotId,
                  blobId: attachmentBindings.blobId,
                })
                .from(attachmentBindings)
                .where(
                  and(
                    eq(attachmentBindings.documentId, documentId),
                    inArray(attachmentBindings.slotId, activeBindingSlotIds),
                    isNull(attachmentBindings.detachedAt),
                  ),
                );

        const activeBindingBySlotId = new Map(
          activeBindings.map((binding) => [binding.slotId, binding]),
        );

        for (const detach of attachmentDetaches) {
          const currentBinding = activeBindingBySlotId.get(detach.slotId);
          if (
            !currentBinding ||
            currentBinding.id !== detach.expectedBindingId
          ) {
            throw new CommitChangeError(
              `Attachment slot ${detach.slotId} is not bound to the expected binding`,
            );
          }
        }

        const stageRows =
          attachmentCommits.length === 0
            ? []
            : await tx
                .select({
                  id: blobStages.id,
                  ownerUserId: blobStages.ownerUserId,
                  encryptedBytes: blobStages.encryptedBytes,
                  sha256: blobStages.sha256,
                  byteLength: blobStages.byteLength,
                  expiresAt: blobStages.expiresAt,
                })
                .from(blobStages)
                .where(
                  inArray(
                    blobStages.id,
                    attachmentCommits.map((commit) => commit.stageId),
                  ),
                );
        const stageById = new Map(stageRows.map((stage) => [stage.id, stage]));

        for (const commit of attachmentCommits) {
          const stage = stageById.get(commit.stageId);
          if (!stage) {
            throw new CommitChangeError(
              `Blob stage ${commit.stageId} does not exist`,
            );
          }

          if (stage.ownerUserId !== session.userId) {
            throw new CommitChangeError(
              `Blob stage ${commit.stageId} does not belong to caller`,
              403,
            );
          }

          if (stage.expiresAt.getTime() <= Date.now()) {
            throw new CommitChangeError(
              `Blob stage ${commit.stageId} has expired`,
            );
          }

          const currentBinding = activeBindingBySlotId.get(commit.slotId);
          const expectedBindingId = commit.expectedBindingId;
          if ((currentBinding?.id ?? null) !== expectedBindingId) {
            throw new CommitChangeError(
              `Attachment slot ${commit.slotId} is not bound to the expected binding`,
            );
          }
        }

        const detachedBindingIds: string[] = [];
        const affectedBlobIds = new Set<string>();
        const committedBindings: Array<{
          slotId: string;
          bindingId: string;
          blobId: string;
        }> = [];

        for (const detach of attachmentDetaches) {
          const currentBinding = activeBindingBySlotId.get(detach.slotId);
          if (!currentBinding) {
            continue;
          }

          await tx
            .update(attachmentBindings)
            .set({ detachedAt: new Date() })
            .where(eq(attachmentBindings.id, currentBinding.id));

          detachedBindingIds.push(currentBinding.id);
          affectedBlobIds.add(currentBinding.blobId);
          activeBindingBySlotId.delete(detach.slotId);
        }

        for (const commit of attachmentCommits) {
          const stage = stageById.get(commit.stageId);
          if (!stage) {
            throw new CommitChangeError(
              `Blob stage ${commit.stageId} does not exist`,
            );
          }

          const currentBinding =
            activeBindingBySlotId.get(commit.slotId) ?? null;
          if (currentBinding) {
            await tx
              .update(attachmentBindings)
              .set({ detachedAt: new Date() })
              .where(eq(attachmentBindings.id, currentBinding.id));
            detachedBindingIds.push(currentBinding.id);
            affectedBlobIds.add(currentBinding.blobId);
          }

          const [blob] = await tx
            .insert(blobs)
            .values({
              byteLength: stage.byteLength,
              encryptedBytes: stage.encryptedBytes,
              sha256: stage.sha256,
              storageKey: stage.id,
            })
            .returning({ id: blobs.id });
          if (!blob) {
            throw new Error(`Failed to promote blob stage ${stage.id}`);
          }

          const [binding] = await tx
            .insert(attachmentBindings)
            .values({
              documentId,
              slotId: commit.slotId,
              blobId: blob.id,
              previousBindingId: currentBinding?.id ?? null,
            })
            .returning({ id: attachmentBindings.id });
          if (!binding) {
            throw new Error(
              `Failed to create attachment binding for ${commit.slotId}`,
            );
          }

          committedBindings.push({
            slotId: commit.slotId,
            bindingId: binding.id,
            blobId: blob.id,
          });
          affectedBlobIds.add(blob.id);
          activeBindingBySlotId.set(commit.slotId, {
            id: binding.id,
            slotId: commit.slotId,
            blobId: blob.id,
          });

          await tx.delete(blobStages).where(eq(blobStages.id, stage.id));
        }

        for (const slotId of referencedSlotIds) {
          if (!activeBindingBySlotId.has(slotId)) {
            throw new CommitChangeError(
              `Loro update references slot ${slotId} without an active binding`,
            );
          }
        }

        const acceptedOutgoingUpdateIds: string[] = [];
        if (loroUpdate) {
          const [existing] = await tx
            .select({ id: documentUpdates.id })
            .from(documentUpdates)
            .where(eq(documentUpdates.id, loroUpdate.id))
            .limit(1);

          if (existing) {
            acceptedOutgoingUpdateIds.push(existing.id);
          } else {
            const [inserted] = await tx
              .insert(documentUpdates)
              .values({
                id: loroUpdate.id,
                documentId,
                authorFingerprint: session.fingerprint,
                encryptedData: loroUpdate.encryptedData,
                partialStartVersionVector: loroUpdate.partialStartVersionVector,
                partialEndVersionVector: loroUpdate.partialEndVersionVector,
              })
              .returning({ id: documentUpdates.id });

            if (inserted) {
              acceptedOutgoingUpdateIds.push(inserted.id);
            }
          }
        }

        await refreshBlobAccesses(Array.from(affectedBlobIds), tx);

        return {
          acceptedOutgoingUpdateIds,
          committedBindings,
          detachedBindingIds,
        };
      });

      if (result.acceptedOutgoingUpdateIds.length > 0) {
        await publish({
          type: "document_update_created",
          documentId,
          updateIds: result.acceptedOutgoingUpdateIds,
        });
      }

      return c.json({
        currentAccessEpoch: access.currentAccessEpoch,
        acceptedOutgoingUpdateIds: result.acceptedOutgoingUpdateIds,
        committedBindings: result.committedBindings,
        detachedBindingIds: result.detachedBindingIds,
      });
    } catch (error) {
      if (error instanceof CommitChangeError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);

documentsRouter.get(
  "/documents/:documentId/attachments",
  requireAuth,
  async (c) => {
    const documentId = c.req.param("documentId");
    const session = c.get("session");

    const access = await resolveDocumentAccessState(documentId);
    if (!access) {
      return c.json({ error: "Document not found" }, 404);
    }

    if (!canReadDocumentAccess(access, session.userId)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const rows = await db
      .select({
        blobId: attachmentBindings.blobId,
        slotId: attachmentBindings.slotId,
      })
      .from(attachmentBindings)
      .where(
        and(
          eq(attachmentBindings.documentId, documentId),
          isNull(attachmentBindings.detachedAt),
        ),
      );

    return c.json<ListDocumentAttachmentsResponse>(
      rows.map((row) => ({
        blobId: row.blobId,
        slotId: row.slotId,
      })),
    );
  },
);

documentsRouter.get("/blobs/:blobId", requireAuth, async (c) => {
  const blobId = c.req.param("blobId");
  const session = c.get("session");

  const access = await resolveBlobAccessState(blobId);
  if (!access) {
    return c.json({ error: "Blob not found" }, 404);
  }

  if (!canReadBlobAccess(access, session.userId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [row] = await db
    .select({
      blobId: blobs.id,
      encryptedBytes: blobs.encryptedBytes,
    })
    .from(blobs)
    .where(eq(blobs.id, blobId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Blob not found" }, 404);
  }

  return c.json<BlobResponse>({
    blobId: row.blobId,
    encryptedBytes: row.encryptedBytes,
  });
});
