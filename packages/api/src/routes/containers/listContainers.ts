import type { ListContainersResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ListContainersError,
  listContainers,
} from "../../services/containers/listContainers";
import type { ApiServiceRuntime } from "../../services/runtime";

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
    const cursor = c.req.query("cursor");
    const depth = parseOptionalInteger(c.req.query("depth"));
    const limit = parseOptionalInteger(c.req.query("limit"));

    try {
      return c.json<ListContainersResponse>(
        await listContainers(runtime, session.userId, {
          ...(cursor === undefined ? {} : { cursor }),
          ...(depth === undefined ? {} : { depth }),
          ...(limit === undefined ? {} : { limit }),
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

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Number(value);
}
