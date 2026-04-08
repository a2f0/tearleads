import type { ListContainersResponse } from "@tearleads/validators/response";
import { Hono } from "hono";
import { requireAuth } from "../../middleware/session";
import { listContainers } from "../../services/containers/listContainers";
import { defaultApiServiceRuntime } from "../../services/runtime";

export const listContainersRoute = new Hono();

listContainersRoute.get("/containers", requireAuth, async (c) => {
  const session = c.get("session");

  return c.json<ListContainersResponse>(
    await listContainers(defaultApiServiceRuntime, session.userId),
  );
});
