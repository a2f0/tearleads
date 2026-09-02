import {
  listContainerDocumentsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ListContainerDocumentsResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ListContainerDocumentsError,
  listContainerDocuments,
} from "../../services/containers/listContainerDocuments";
import type { ApiServiceRuntime } from "../../services/runtime";
import { pathParamsValidator } from "../../validators/pathParams";
import { queryParamsValidator } from "../../validators/queryParams";
import { respondToStatusError } from "../errorResponse";

interface ListContainerDocumentsRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createListContainerDocumentsRoute({
  requireAuth,
  runtime,
}: ListContainerDocumentsRouteDeps) {
  const listContainerDocumentsRoute = new Hono<SessionEnv>();

  listContainerDocumentsRoute.on(
    listContainerDocumentsOperation.method,
    operationRoutePath(listContainerDocumentsOperation),
    requireAuth,
    pathParamsValidator(listContainerDocumentsOperation.params),
    queryParamsValidator(
      listContainerDocumentsOperation.query,
      (schemaMessage) => schemaMessage ?? "Invalid request",
    ),
    async (c) => {
      const session = c.get("session");
      const { containerId } = c.req.valid("param");
      const { limit, watermarkId, watermarkUpdatedAt } = c.req.valid("query");
      // The query schema enforces both watermark params present or both absent.
      const watermark =
        watermarkUpdatedAt !== undefined && watermarkId !== undefined
          ? { id: watermarkId, updatedAt: watermarkUpdatedAt }
          : undefined;

      try {
        return c.json<ListContainerDocumentsResponse>(
          await listContainerDocuments(runtime, containerId, session.userId, {
            ...(limit === undefined ? {} : { limit }),
            ...(watermark === undefined ? {} : { watermark }),
          }),
        );
      } catch (error) {
        return respondToStatusError(c, error, ListContainerDocumentsError, {
          code: CONTAINER_NOT_FOUND_ERROR_CODE,
          status: 404,
        });
      }
    },
  );

  return listContainerDocumentsRoute;
}
