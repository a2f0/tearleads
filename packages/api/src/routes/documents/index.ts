import { createLoroRouter } from "@tearleads/loro/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../../adapters/postgres";
import { publish } from "../../adapters/redisPubSub";
import { requireAuth } from "../../middleware/session";
import { documents, documentUpdates } from "../../schema";

export const documentsRouter = createLoroRouter({
  store: {
    async createDocument(input) {
      const [document] = await db.insert(documents).values(input).returning();
      return document ?? null;
    },
    async getDocumentById(documentId) {
      const [document] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, documentId));
      return document ?? null;
    },
    async appendDocumentUpdate(input) {
      const [update] = await db
        .insert(documentUpdates)
        .values(input)
        .returning();
      return update ?? null;
    },
    async listDocumentUpdates({ documentId, since }) {
      return db
        .select()
        .from(documentUpdates)
        .where(
          since === null
            ? eq(documentUpdates.documentId, documentId)
            : and(
                eq(documentUpdates.documentId, documentId),
                gt(documentUpdates.sequence, since),
              ),
        )
        .orderBy(documentUpdates.sequence);
    },
  },
  publish,
  requireAuth,
});
