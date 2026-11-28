import {
  allowDocumentPeerRestoreOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type {
  DocumentMutationFailureResponse,
  DocumentPeerRestoreAllowResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import {
  allowDocumentPeerRestore,
  DocumentMutationError,
} from "../../services/documents/documentMutations";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { publishDocumentPeerRestoreAllowedEvent } from "./mutationEvents";

interface DocumentPeerRestoreRouteDeps {
  readonly publish: (event: PublishedRealtimeEvent) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createDocumentPeerRestoreRoute({
  publish,
  requireAuth,
  runtime,
}: DocumentPeerRestoreRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    allowDocumentPeerRestoreOperation.method,
    operationRoutePath(allowDocumentPeerRestoreOperation),
    requireAuth,
    pathParamsValidator(allowDocumentPeerRestoreOperation.params),
    jsonRequestValidator(allowDocumentPeerRestoreOperation.body),
    async (c) => {
      const { documentId } = c.req.valid("param");
      const request = c.req.valid("json");
      const session = c.get("session");
      try {
        const { containerPaths, linkedContainerIds, response } =
          await allowDocumentPeerRestore(runtime, {
            documentId,
            request,
            userId: session.userId,
          });
        if (response.allowMemberRestore && response.updatedPeerCount > 0) {
          await publishDocumentPeerRestoreAllowedEvent({
            containerIds: linkedContainerIds,
            containerPaths,
            documentId,
            origin: { sessionId: session.id, userId: session.userId },
            publish,
          });
        }
        return c.json<DocumentPeerRestoreAllowResponse>(response);
      } catch (error) {
        if (error instanceof DocumentMutationError) {
          return c.json<DocumentMutationFailureResponse>(
            {
              ...(error.code === undefined ? {} : { code: error.code }),
              error: error.message,
            },
            error.status,
          );
        }
        throw error;
      }
    },
  );

  return route;
}
