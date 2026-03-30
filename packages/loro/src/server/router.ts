import { Hono, type MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import {
  type AppendDocumentUpdateResponse,
  type CreateDocumentResponse,
  type DocumentUpdate,
  type GetDocumentUpdatesResponse,
  isAppendDocumentUpdateRequest,
} from "../shared";
import type { DocumentRecord, DocumentUpdateRecord } from "./schema";

interface SessionLike {
  fingerprint: string;
}

type LoroEnv<TSession extends SessionLike> = {
  Variables: {
    session: TSession;
  };
};

interface LoroRouterDeps<TSession extends SessionLike> {
  store: {
    createDocument(input: {
      createdByFingerprint: string;
    }): Promise<DocumentRecord | null>;
    getDocumentById(documentId: string): Promise<DocumentRecord | null>;
    appendDocumentUpdate(input: {
      documentId: string;
      authorFingerprint: string;
      encryptedData: string;
    }): Promise<DocumentUpdateRecord | null>;
    listDocumentUpdates(input: {
      documentId: string;
      since: number | null;
    }): Promise<DocumentUpdateRecord[]>;
  };
  publish: (event: Record<string, unknown>) => Promise<void>;
  requireAuth: MiddlewareHandler<LoroEnv<TSession>>;
}

export function createLoroRouter<TSession extends SessionLike>({
  store,
  publish,
  requireAuth,
}: LoroRouterDeps<TSession>) {
  const router = new Hono<LoroEnv<TSession>>();

  router.post("/documents", requireAuth, async (c) => {
    const session = c.get("session");

    const document = await store.createDocument({
      createdByFingerprint: session.fingerprint,
    });

    if (!document) {
      return c.json({ error: "Failed to create document" }, 500);
    }

    return c.json<CreateDocumentResponse>({
      id: document.id,
      createdAt: document.createdAt.toISOString(),
    });
  });

  router.post(
    "/documents/:documentId/updates",
    requireAuth,
    validator("json", (value, c) => {
      if (!isAppendDocumentUpdateRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }
      return value;
    }),
    async (c) => {
      const { encryptedData } = c.req.valid("json");
      const documentId = c.req.param("documentId");
      const session = c.get("session");

      const document = await store.getDocumentById(documentId);

      if (!document) {
        return c.json({ error: "Document not found" }, 404);
      }

      const update = await store.appendDocumentUpdate({
        documentId,
        authorFingerprint: session.fingerprint,
        encryptedData,
      });

      if (!update) {
        return c.json({ error: "Failed to append document update" }, 500);
      }

      await publish({
        type: "document_update_created",
        documentId,
        updateId: update.id,
        authorFingerprint: update.authorFingerprint,
        sequence: update.sequence,
      });

      return c.json<AppendDocumentUpdateResponse>({
        id: update.id,
        sequence: update.sequence,
        createdAt: update.createdAt.toISOString(),
      });
    },
  );

  router.get("/documents/:documentId/updates", requireAuth, async (c) => {
    const documentId = c.req.param("documentId");
    const sinceParam = c.req.query("since");
    const since =
      sinceParam === undefined ? null : Number.parseInt(sinceParam, 10);

    if (sinceParam !== undefined && Number.isNaN(since)) {
      return c.json({ error: "Invalid since cursor" }, 400);
    }

    const document = await store.getDocumentById(documentId);

    if (!document) {
      return c.json({ error: "Document not found" }, 404);
    }

    const updates = await store.listDocumentUpdates({ documentId, since });

    const responseUpdates: DocumentUpdate[] = updates.map((update) => ({
      id: update.id,
      documentId: update.documentId,
      sequence: update.sequence,
      authorFingerprint: update.authorFingerprint,
      encryptedData: update.encryptedData,
      createdAt: update.createdAt.toISOString(),
    }));

    return c.json<GetDocumentUpdatesResponse>({
      documentId,
      updates: responseUpdates,
      nextCursor:
        responseUpdates.length > 0
          ? (responseUpdates[responseUpdates.length - 1]?.sequence ?? null)
          : since,
    });
  });

  return router;
}
