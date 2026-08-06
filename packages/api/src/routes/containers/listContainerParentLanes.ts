import {
  listContainerParentLanesOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { listContainerParentLanes } from "../../services/containers/listContainerParentLanes";
import { ListContainersError } from "../../services/containers/listContainers";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";

interface ListContainerParentLanesRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createListContainerParentLanesRoute({
  requireAuth,
  runtime,
}: ListContainerParentLanesRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    listContainerParentLanesOperation.method,
    operationRoutePath(listContainerParentLanesOperation),
    requireAuth,
    jsonRequestValidator(listContainerParentLanesOperation.body),
    async (c) => {
      try {
        return c.json<ListContainerParentLanesResponse>(
          await listContainerParentLanes(
            runtime,
            c.get("session").userId,
            c.req.valid("json"),
          ),
        );
      } catch (error) {
        if (error instanceof ListContainersError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return route;
}
