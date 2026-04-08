import { isLinkDocumentToContainerRequest } from "@tearleads/validators/request";
import type {
  LinkDocumentToContainerResponse,
  UnlinkDocumentFromContainerResponse,
} from "@tearleads/validators/response";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { requireAuth } from "../../middleware/session";
import { linkDocumentToContainer } from "../../services/documents/linkDocumentToContainer";
import { StructuralDocumentMutationError } from "../../services/documents/shared";
import { unlinkDocumentFromContainer } from "../../services/documents/unlinkDocumentFromContainer";
import { defaultApiServiceRuntime } from "../../services/runtime";

export const structuralDocumentsRoute = new Hono();

structuralDocumentsRoute.post(
  "/documents/:documentId/link",
  requireAuth,
  validator("json", (value, c) => {
    if (!isLinkDocumentToContainerRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  }),
  async (c) => {
    const session = c.get("session");
    const documentId = c.req.param("documentId");

    try {
      return c.json<LinkDocumentToContainerResponse>(
        await linkDocumentToContainer(defaultApiServiceRuntime, {
          ...c.req.valid("json"),
          documentId,
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof StructuralDocumentMutationError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);

structuralDocumentsRoute.post(
  "/documents/:documentId/unlink",
  requireAuth,
  validator("json", (value, c) => {
    if (!isLinkDocumentToContainerRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  }),
  async (c) => {
    const session = c.get("session");
    const documentId = c.req.param("documentId");

    try {
      return c.json<UnlinkDocumentFromContainerResponse>(
        await unlinkDocumentFromContainer(defaultApiServiceRuntime, {
          ...c.req.valid("json"),
          documentId,
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof StructuralDocumentMutationError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);
