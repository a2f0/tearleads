import {
  getBlobDownloadOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { GetBlobError, getBlobDownload } from "../../services/blobs/getBlob";
import type { ApiServiceRuntime } from "../../services/runtime";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

export function createGetBlobDownloadRoute(input: {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}) {
  const route = new Hono();
  route.on(
    getBlobDownloadOperation.method,
    operationRoutePath(getBlobDownloadOperation),
    input.requireAuth,
    pathParamsValidator(getBlobDownloadOperation.params),
    async (c) => {
      // A signed URL is a bearer credential, including when returned as JSON.
      c.header("Cache-Control", "no-store");
      try {
        return c.json(
          await getBlobDownload(input.runtime, {
            blobId: c.req.valid("param").blobId,
            userId: c.get("session").userId,
          }),
        );
      } catch (error) {
        return respondToStatusError(c, error, GetBlobError);
      }
    },
  );
  return route;
}
