import { ListContainerParentLanesRequestSchema } from "@tearleads/validators/request";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import { listContainerParentLanes } from "../../services/containers/listContainerParentLanes";
import { ListContainersError } from "../../services/containers/listContainers";
import type { ApiServiceRuntime } from "../../services/runtime";

interface ListContainerParentLanesRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createListContainerParentLanesRoute({
  requireAuth,
  runtime,
}: ListContainerParentLanesRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.post(
    "/containers/parent-lanes/query",
    requireAuth,
    validator("json", (value, c) => {
      const parsed = ListContainerParentLanesRequestSchema.safeParse(value);
      if (!parsed.success) {
        return c.json({ error: "Invalid request" }, 400);
      }
      return parsed.data;
    }),
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
