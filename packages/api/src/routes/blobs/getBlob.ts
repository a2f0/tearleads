import {
  blobWireHeaderNames,
  getBlobBytesOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { GetBlobError, getBlobBytes } from "../../services/blobs/getBlob";
import type { ApiServiceRuntime } from "../../services/runtime";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

interface GetBlobRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createGetBlobRoute({ requireAuth, runtime }: GetBlobRouteDeps) {
  const getBlobRoute = new Hono();

  getBlobRoute.on(
    getBlobBytesOperation.method,
    operationRoutePath(getBlobBytesOperation),
    requireAuth,
    pathParamsValidator(getBlobBytesOperation.params),
    async (c) => {
      const { blobId } = c.req.valid("param");
      const session = c.get("session");

      try {
        const blob = await getBlobBytes(runtime, {
          blobId,
          userId: session.userId,
        });

        return new Response(blob.encryptedBytes, {
          headers: {
            "Access-Control-Expose-Headers": [
              "Content-Length",
              blobWireHeaderNames.blobByteLength,
              blobWireHeaderNames.blobId,
              blobWireHeaderNames.blobSha256,
            ].join(", "),
            "Cache-Control": "no-store",
            "Content-Length": blob.byteLength.toString(),
            "Content-Type": "application/octet-stream",
            [blobWireHeaderNames.blobByteLength]: blob.byteLength.toString(),
            [blobWireHeaderNames.blobId]: blob.blobId,
            [blobWireHeaderNames.blobSha256]: blob.sha256,
          },
        });
      } catch (error) {
        return respondToStatusError(c, error, GetBlobError);
      }
    },
  );

  return getBlobRoute;
}
