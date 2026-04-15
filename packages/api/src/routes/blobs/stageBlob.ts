import { isStageBlobRequest } from "@tearleads/validators/request";
import type { StageBlobResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import { StageBlobError, stageBlob } from "../../services/blobs/stageBlob";
import type { ApiServiceRuntime } from "../../services/runtime";

interface StageBlobRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createStageBlobRoute({
  requireAuth,
  runtime,
}: StageBlobRouteDeps) {
  const stageBlobRoute = new Hono();

  stageBlobRoute.post(
    "/blobs/stage",
    requireAuth,
    validator("json", (value, c) => {
      if (!isStageBlobRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return value;
    }),
    async (c) => {
      const session = c.get("session");

      try {
        return c.json<StageBlobResponse>(
          await stageBlob(runtime, {
            ...c.req.valid("json"),
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof StageBlobError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return stageBlobRoute;
}
