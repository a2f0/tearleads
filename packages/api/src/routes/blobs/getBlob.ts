import type { BlobResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import { GetBlobError, getBlob } from "../../services/blobs/getBlob";
import type { ApiServiceRuntime } from "../../services/runtime";

const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

interface GetBlobRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

function isUuidString(value: string): boolean {
  return new RegExp(UUID_PATTERN).test(value);
}

export function createGetBlobRoute({ requireAuth, runtime }: GetBlobRouteDeps) {
  const getBlobRoute = new Hono();

  getBlobRoute.get(
    "/blobs/:blobId",
    requireAuth,
    validator("param", (value, c) => {
      const { blobId } = value as { blobId?: string };

      if (typeof blobId !== "string" || !isUuidString(blobId)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return { blobId };
    }),
    async (c) => {
      const { blobId } = c.req.valid("param");
      const session = c.get("session");

      try {
        return c.json<BlobResponse>(
          await getBlob(runtime, {
            blobId,
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof GetBlobError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );

  return getBlobRoute;
}
