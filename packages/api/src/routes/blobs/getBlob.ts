import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import { GetBlobError, getBlobBytes } from "../../services/blobs/getBlob";
import type { ApiServiceRuntime } from "../../services/runtime";
import { isUuidString } from "../../utils/uuid";

const BLOB_BYTES_BYTE_LENGTH_HEADER = "X-Tearleads-Blob-Byte-Length";
const BLOB_BYTES_BLOB_ID_HEADER = "X-Tearleads-Blob-Id";
const BLOB_BYTES_SHA256_HEADER = "X-Tearleads-Blob-Sha256";

interface GetBlobRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

function readStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const item = Reflect.get(value, key);
  return typeof item === "string" ? item : null;
}

export function createGetBlobRoute({ requireAuth, runtime }: GetBlobRouteDeps) {
  const getBlobRoute = new Hono();
  const validateBlobId = validator("param", (value, c) => {
    const blobId = readStringProperty(value, "blobId");

    if (blobId === null || !isUuidString(blobId)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return { blobId };
  });

  getBlobRoute.get(
    "/blobs/:blobId/bytes",
    requireAuth,
    validateBlobId,
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
              BLOB_BYTES_BYTE_LENGTH_HEADER,
              BLOB_BYTES_BLOB_ID_HEADER,
              BLOB_BYTES_SHA256_HEADER,
            ].join(", "),
            "Cache-Control": "no-store",
            "Content-Length": blob.byteLength.toString(),
            "Content-Type": "application/octet-stream",
            [BLOB_BYTES_BYTE_LENGTH_HEADER]: blob.byteLength.toString(),
            [BLOB_BYTES_BLOB_ID_HEADER]: blob.blobId,
            [BLOB_BYTES_SHA256_HEADER]: blob.sha256,
          },
        });
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
