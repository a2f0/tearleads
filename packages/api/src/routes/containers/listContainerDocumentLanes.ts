import {
  listContainerDocumentLanesOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { ListContainerDocumentLanesResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { listContainerDocumentLanes } from "../../services/containers/listContainerDocumentLanes";
import { ListContainerDocumentsError } from "../../services/containers/listContainerDocuments";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { respondToStatusError } from "../errorResponse";

interface ListContainerDocumentLanesRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createListContainerDocumentLanesRoute({
  requireAuth,
  runtime,
}: ListContainerDocumentLanesRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    listContainerDocumentLanesOperation.method,
    operationRoutePath(listContainerDocumentLanesOperation),
    requireAuth,
    jsonRequestValidator(listContainerDocumentLanesOperation.body),
    async (c) => {
      try {
        return c.json<ListContainerDocumentLanesResponse>(
          await listContainerDocumentLanes(
            runtime,
            c.get("session").userId,
            c.req.valid("json"),
          ),
        );
      } catch (error) {
        return respondToStatusError(c, error, ListContainerDocumentsError);
      }
    },
  );

  return route;
}
