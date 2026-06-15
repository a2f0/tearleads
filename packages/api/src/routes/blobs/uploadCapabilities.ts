import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getBlobUploadCapabilities } from "../../services/blobs/uploadCapabilities";
import type { ApiServiceRuntime } from "../../services/runtime";

interface BlobUploadCapabilitiesRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createBlobUploadCapabilitiesRoute({
  requireAuth,
  runtime,
}: BlobUploadCapabilitiesRouteDeps) {
  const route = new Hono();

  route.get("/blobs/uploads/capabilities", requireAuth, (c) =>
    c.json(getBlobUploadCapabilities(runtime)),
  );

  return route;
}
