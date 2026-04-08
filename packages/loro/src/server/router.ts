import { Hono, type MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import { satisfiesVersionVector } from "../document";
import { readEncryptedUpdateAccessEpoch } from "../encryptedUpdate";
import {
  type CreateDocumentResponse,
  type DocumentSyncUpdate,
  isCreateDocumentRequest,
  isSyncDocumentRequest,
  type SerializedRecipientEnvelope,
  type SyncDocumentOutgoingUpdate,
  type SyncDocumentResponse,
} from "../shared";
import type { DocumentRecord, DocumentUpdateRecord } from "./schema";

interface SessionLike {
  userId: string;
  fingerprint: string;
}

type LoroEnv<TSession extends SessionLike> = {
  Variables: {
    session: TSession;
  };
};

interface DocumentAccessState {
  canRead: boolean;
  canWrite: boolean;
  currentAccessEpoch: number;
  documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
  recipientKeyFingerprints: string[];
  recipientEncapsulationPublicKeys: string[];
}

interface LoroRouterDeps<TSession extends SessionLike> {
  store: {
    createDocument(input: {
      createdByFingerprint: string;
      createdByUserId: string;
      linkedContainerIds: string[];
    }): Promise<{
      document: DocumentRecord;
      currentAccessEpoch: number;
      documentRecipientEnvelopes: SerializedRecipientEnvelope[] | null;
      recipientEncapsulationPublicKeys: string[];
    } | null>;
    getDocumentById(documentId: string): Promise<DocumentRecord | null>;
    getDocumentAccess(input: {
      documentId: string;
      userId: string;
    }): Promise<DocumentAccessState | null>;
    appendDocumentUpdates(input: {
      documentId: string;
      authorFingerprint: string;
      documentRecipientEnvelopes?: SerializedRecipientEnvelope[];
      updates: SyncDocumentOutgoingUpdate[];
    }): Promise<string[]>;
    listDocumentUpdates(documentId: string): Promise<DocumentUpdateRecord[]>;
  };
  publish: (event: Record<string, unknown>) => Promise<void>;
  requireAuth: MiddlewareHandler<LoroEnv<TSession>>;
}

interface StatusError extends Error {
  status: 400 | 403 | 404 | 409;
}

function isStatusError(error: unknown): error is StatusError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  );
}

function matchesAccessEpoch(
  encryptedData: string,
  expectedAccessEpoch: number,
): boolean {
  return readEncryptedUpdateAccessEpoch(encryptedData) === expectedAccessEpoch;
}

function toSyncUpdate(update: DocumentUpdateRecord): DocumentSyncUpdate {
  return {
    id: update.id,
    documentId: update.documentId,
    authorFingerprint: update.authorFingerprint,
    encryptedData: update.encryptedData,
    partialStartVersionVector: update.partialStartVersionVector,
    partialEndVersionVector: update.partialEndVersionVector,
    createdAt: update.createdAt.toISOString(),
  };
}

export function createLoroRouter<TSession extends SessionLike>({
  store,
  publish,
  requireAuth,
}: LoroRouterDeps<TSession>) {
  const router = new Hono<LoroEnv<TSession>>();

  router.post(
    "/documents",
    requireAuth,
    validator("json", (value, c) => {
      if (!isCreateDocumentRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const session = c.get("session");
      const { linkedContainerIds } = c.req.valid("json");

      try {
        const created = await store.createDocument({
          createdByFingerprint: session.fingerprint,
          createdByUserId: session.userId,
          linkedContainerIds,
        });

        if (!created) {
          return c.json({ error: "Failed to create document" }, 500);
        }

        return c.json<CreateDocumentResponse>({
          id: created.document.id,
          createdAt: created.document.createdAt.toISOString(),
          currentAccessEpoch: created.currentAccessEpoch,
          documentRecipientEnvelopes: created.documentRecipientEnvelopes,
          recipientEncapsulationPublicKeys:
            created.recipientEncapsulationPublicKeys,
        });
      } catch (error) {
        if (isStatusError(error)) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  router.post(
    "/documents/:documentId/sync",
    requireAuth,
    validator("json", (value, c) => {
      if (!isSyncDocumentRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const documentId = c.req.param("documentId");
      const { accessEpoch, localVersionVector, outgoingUpdates } =
        c.req.valid("json");
      const { documentRecipientEnvelopes } = c.req.valid("json");
      const session = c.get("session");

      const document = await store.getDocumentById(documentId);
      if (!document) {
        return c.json({ error: "Document not found" }, 404);
      }

      const access = await store.getDocumentAccess({
        documentId,
        userId: session.userId,
      });

      if (!access) {
        return c.json({ error: "Document access state not found" }, 500);
      }

      if (!access.canRead) {
        return c.json({ error: "Forbidden" }, 403);
      }

      if (outgoingUpdates.length > 0 && !access.canWrite) {
        return c.json({ error: "Forbidden" }, 403);
      }

      let acceptedOutgoingUpdateIds: string[] = [];
      let responseDocumentRecipientEnvelopes =
        access.documentRecipientEnvelopes;

      if (accessEpoch === access.currentAccessEpoch) {
        for (const outgoingUpdate of outgoingUpdates) {
          try {
            if (
              !matchesAccessEpoch(outgoingUpdate.encryptedData, accessEpoch)
            ) {
              return c.json(
                { error: "Encrypted update access epoch mismatch" },
                400,
              );
            }
          } catch {
            return c.json({ error: "Invalid encrypted update envelope" }, 400);
          }
        }

        if (
          outgoingUpdates.length > 0 ||
          documentRecipientEnvelopes !== undefined
        ) {
          acceptedOutgoingUpdateIds = await store.appendDocumentUpdates({
            documentId,
            authorFingerprint: session.fingerprint,
            updates: outgoingUpdates,
            ...(documentRecipientEnvelopes
              ? { documentRecipientEnvelopes }
              : {}),
          });
          if (documentRecipientEnvelopes) {
            responseDocumentRecipientEnvelopes = documentRecipientEnvelopes;
          }
        }
      }

      const updates = await store.listDocumentUpdates(documentId);
      const missingUpdates = updates
        .filter(
          (update) =>
            !satisfiesVersionVector(
              localVersionVector,
              update.partialEndVersionVector,
            ),
        )
        .map((update) => toSyncUpdate(update));

      if (acceptedOutgoingUpdateIds.length > 0) {
        await publish({
          type: "document_update_created",
          documentId,
          updateIds: acceptedOutgoingUpdateIds,
        });
      }

      return c.json<SyncDocumentResponse>({
        documentId,
        acceptedOutgoingUpdateIds,
        updates: missingUpdates,
        currentAccessEpoch: access.currentAccessEpoch,
        documentRecipientEnvelopes: responseDocumentRecipientEnvelopes,
        recipientEncapsulationPublicKeys:
          access.recipientEncapsulationPublicKeys,
      });
    },
  );

  return router;
}
