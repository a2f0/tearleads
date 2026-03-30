import { createLoroRouter } from "@tearleads/loro/server";
import { eq } from "drizzle-orm";
import {
  canReadDocumentAccess,
  canWriteDocumentAccess,
  initializeDocumentAccess,
  listRecipientKeyFingerprints,
  resolveDocumentAccessState,
} from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { publish } from "../../adapters/redisPubSub";
import { requireAuth } from "../../middleware/session";
import { documents, documentUpdates } from "../../schema";

export const documentsRouter = createLoroRouter({
  store: {
    async createDocument(input) {
      const [document] = await db
        .insert(documents)
        .values({
          createdByFingerprint: input.createdByFingerprint,
        })
        .returning();
      if (!document) {
        return null;
      }

      const currentAccessEpoch = await initializeDocumentAccess(
        document.id,
        input.createdByUserId,
      );

      return { document, currentAccessEpoch };
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
