import { createLoroRouter } from "@tearleads/loro/server";
import {
  isCommitDocumentChangeRequest,
  isStageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobResponse,
  CommitDocumentChangeResponse,
  ListDocumentAttachmentsResponse,
  StageBlobResponse,
} from "@tearleads/validators/response";
import { validator } from "hono/validator";
import { publish } from "../../adapters/redisPubSub";
import { requireAuth } from "../../middleware/session";
import {
  CommitDocumentChangeError,
  commitDocumentChange,
} from "../../services/documents/commitDocumentChange";
import { createDocumentSyncStore } from "../../services/documents/documentSyncStore";
import { GetBlobError, getBlob } from "../../services/documents/getBlob";
import {
  ListDocumentAttachmentsError,
  listDocumentAttachments,
} from "../../services/documents/listDocumentAttachments";
import { StageBlobError, stageBlob } from "../../services/documents/stageBlob";
import { defaultApiServiceRuntime } from "../../services/runtime";

export const documentsRouter = createLoroRouter({
  store: createDocumentSyncStore(defaultApiServiceRuntime),
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

    try {
      return c.json<StageBlobResponse>(
        await stageBlob(defaultApiServiceRuntime, {
          ...c.req.valid("json"),
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof StageBlobError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
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
    const request = c.req.valid("json");

    try {
      const result = await commitDocumentChange(defaultApiServiceRuntime, {
        documentId,
        request,
        session,
      });

      if (result.acceptedOutgoingUpdateIds.length > 0) {
        await publish({
          type: "document_update_created",
          documentId,
          updateIds: result.acceptedOutgoingUpdateIds,
        });
      }

      return c.json<CommitDocumentChangeResponse>(result);
    } catch (error) {
      if (error instanceof CommitDocumentChangeError) {
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

    try {
      return c.json<ListDocumentAttachmentsResponse>(
        await listDocumentAttachments(defaultApiServiceRuntime, {
          documentId,
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof ListDocumentAttachmentsError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);

documentsRouter.get("/blobs/:blobId", requireAuth, async (c) => {
  const blobId = c.req.param("blobId");
  const session = c.get("session");

  try {
    return c.json<BlobResponse>(
      await getBlob(defaultApiServiceRuntime, {
        blobId,
        userId: session.userId,
      }),
    );
  } catch (error) {
    if (error instanceof GetBlobError) {
      return c.json({ error: error.message }, error.status);
    }

    throw error;
  }
});
