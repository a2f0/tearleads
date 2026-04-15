import type { BlobResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { GetBlobError, getBlob } from "../../services/blobs/getBlob";
import type { ApiServiceRuntime } from "../../services/runtime";

interface GetBlobRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createGetBlobRoute({ requireAuth, runtime }: GetBlobRouteDeps) {
  const getBlobRoute = new Hono();

  getBlobRoute.get("/blobs/:blobId", requireAuth, async (c) => {
    const blobId = c.req.param("blobId");
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
  });

  return getBlobRoute;
}
