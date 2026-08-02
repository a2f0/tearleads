import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import { MAX_CONTAINER_KEY_EPOCH } from "@tearleads/validators/util";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getContainerKekLog } from "../../services/containers/kekLog";
import { ContainerWriterProjectionError } from "../../services/containers/writerProjection";
import type { ApiServiceRuntime } from "../../services/runtime";

/**
 * A malformed cursor reads as "from the beginning", never as an error. The
 * same parse serves `keyringForEpoch`, where 0 means "no keyring".
 *
 * Values above `MAX_CONTAINER_KEY_EPOCH` are out of domain and are rejected
 * here rather than passed down: a safe integer can still exceed PostgreSQL's
 * `integer` column range, which would surface as a 500 on what is really a
 * malformed request. No in-domain cursor is affected, since no epoch can
 * exceed that cap in the first place.
 */
function readAfterKeyEpoch(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAX_CONTAINER_KEY_EPOCH
    ? parsed
    : 0;
}

interface ContainerKekLogRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createContainerKekLogRoute({
  requireAuth,
  runtime,
}: ContainerKekLogRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.get("/containers/:containerId/kek-log", requireAuth, async (c) => {
    const session = c.get("session");

    try {
      return c.json<ContainerKekLogResponse>(
        await getContainerKekLog(runtime, {
          afterKeyEpoch: readAfterKeyEpoch(c.req.query("afterKeyEpoch")),
          containerId: c.req.param("containerId"),
          keyringForEpoch: readAfterKeyEpoch(c.req.query("keyringForEpoch")),
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof ContainerWriterProjectionError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  });

  return route;
}
