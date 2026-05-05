import type { ListContainersResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ListContainersError,
  listContainers,
} from "../../services/containers/listContainers";
import type { ApiServiceRuntime } from "../../services/runtime";
import {
  parseOptionalInteger,
  parseOptionalParentId,
  parseOptionalWatermark,
} from "./queryParams";

interface ListContainersRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createListContainersRoute({
  requireAuth,
  runtime,
}: ListContainersRouteDeps) {
  const listContainersRoute = new Hono();

  listContainersRoute.get("/containers", requireAuth, async (c) => {
    const session = c.get("session");
    const limit = parseOptionalInteger(c.req.query("limit"));
    const parentId = parseOptionalParentId(c.req.query("parentId"));
    const watermark = parseOptionalWatermark(
      c.req.query("watermarkUpdatedAt"),
      c.req.query("watermarkId"),
    );

    try {
      return c.json<ListContainersResponse>(
        await listContainers(runtime, session.userId, {
          ...(limit === undefined ? {} : { limit }),
          parentId,
          ...(watermark === undefined ? {} : { watermark }),
        }),
      );
    } catch (error) {
      if (error instanceof ListContainersError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  });

  return listContainersRoute;
}
