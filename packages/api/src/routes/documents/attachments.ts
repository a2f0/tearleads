import {
  listDocumentAttachmentsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { ListDocumentAttachmentsResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ListDocumentAttachmentsError,
  listDocumentAttachments,
} from "../../services/documents/listDocumentAttachments";
import type { ApiServiceRuntime } from "../../services/runtime";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

interface DocumentAttachmentsRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createDocumentAttachmentsRoute({
  requireAuth,
  runtime,
}: DocumentAttachmentsRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    listDocumentAttachmentsOperation.method,
    operationRoutePath(listDocumentAttachmentsOperation),
    requireAuth,
    pathParamsValidator(
      listDocumentAttachmentsOperation.params,
      "Invalid documentId",
    ),
    async (c) => {
      const { documentId } = c.req.valid("param");
      const session = c.get("session");

      try {
        return c.json<ListDocumentAttachmentsResponse>(
          await listDocumentAttachments(runtime, {
            documentId,
            userId: session.userId,
          }),
        );
      } catch (error) {
        return respondToStatusError(c, error, ListDocumentAttachmentsError);
      }
    },
  );

  return route;
}
