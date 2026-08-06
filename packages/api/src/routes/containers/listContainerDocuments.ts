import {
  listContainerDocumentsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { ListContainerDocumentsResponse } from "@tearleads/validators/response";
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
import { parseOptionalWatermark } from "./queryParams";

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
      const {
        limit: limitValue,
        watermarkId,
        watermarkUpdatedAt,
      } = c.req.valid("query");
      const limit = limitValue === undefined ? undefined : Number(limitValue);
      const watermark = parseOptionalWatermark(watermarkUpdatedAt, watermarkId);

      try {
        return c.json<ListContainerDocumentsResponse>(
          await listContainerDocuments(runtime, containerId, session.userId, {
            ...(limit === undefined ? {} : { limit }),
            ...(watermark === undefined ? {} : { watermark }),
          }),
        );
      } catch (error) {
        if (error instanceof ListContainerDocumentsError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return listContainerDocumentsRoute;
}
