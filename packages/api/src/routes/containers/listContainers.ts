import type { ListContainersResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import {
  requireAuth as defaultRequireAuth,
  type SessionEnv,
} from "../../middleware/session";
import { listContainers } from "../../services/containers/listContainers";
import {
  type ApiServiceRuntime,
  defaultApiServiceRuntime,
} from "../../services/runtime";

interface ListContainersRouteDeps {
  readonly requireAuth?: MiddlewareHandler<SessionEnv>;
  readonly runtime?: ApiServiceRuntime;
}

export function createListContainersRoute({
  requireAuth = defaultRequireAuth,
  runtime = defaultApiServiceRuntime,
}: ListContainersRouteDeps = {}) {
  const listContainersRoute = new Hono();

  listContainersRoute.get("/containers", requireAuth, async (c) => {
    const session = c.get("session");

    return c.json<ListContainersResponse>(
      await listContainers(runtime, session.userId),
    );
  });

  return listContainersRoute;
}

export const listContainersRoute = createListContainersRoute();
