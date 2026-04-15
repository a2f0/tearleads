import { isLinkDocumentToContainerRequest } from "@tearleads/validators/request";
import type {
  LinkDocumentToContainerResponse,
  UnlinkDocumentFromContainerResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import { linkDocumentToContainer } from "../../services/documents/linkDocumentToContainer";
import { StructuralDocumentMutationError } from "../../services/documents/shared";
import { unlinkDocumentFromContainer } from "../../services/documents/unlinkDocumentFromContainer";
import type { ApiServiceRuntime } from "../../services/runtime";

interface StructuralDocumentsRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createStructuralDocumentsRoute({
  requireAuth,
  runtime,
}: StructuralDocumentsRouteDeps) {
  const structuralDocumentsRoute = new Hono();

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
          await linkDocumentToContainer(runtime, {
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
          await unlinkDocumentFromContainer(runtime, {
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

  return structuralDocumentsRoute;
}
