import {
  completeMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type {
  CompleteMultipartBlobStageResponse,
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
  UploadMultipartBlobPartResponse,
} from "@tearleads/validators/response";
import { isSha256HexString } from "@tearleads/validators/util";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { MAX_UPLOAD_PART_BYTES } from "../../adapters/blobObjectStore";
import type { SessionEnv } from "../../middleware/session";
import {
  completeMultipartBlobStage,
  getMultipartBlobStage,
  initiateMultipartBlobStage,
  MultipartBlobStageError,
  uploadMultipartBlobPartBytes,
} from "../../services/blobs/multipartStage";
import type { ApiServiceRuntime } from "../../services/runtime";
import { isUuidString } from "../../utils/uuid";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";

const BLOB_PART_BYTE_LENGTH_HEADER = "X-Tearleads-Blob-Part-Byte-Length";
const BLOB_PART_SHA256_HEADER = "X-Tearleads-Blob-Part-Sha256";
const BLOB_PART_UPLOAD_ID_HEADER = "X-Tearleads-Blob-Upload-Id";

interface MultipartBlobStageRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

interface JsonValidationContext {
  json: (body: { readonly error: string }, status: 400) => Response;
}

interface MultipartBlobPartParams {
  readonly partNumber: number;
  readonly stageId: string;
}

function readStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const item = Reflect.get(value, key);
  return typeof item === "string" ? item : null;
}

function parseSafePositiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validatePartRouteParams(
  value: unknown,
  c: JsonValidationContext,
): MultipartBlobPartParams | Response {
  const partNumber = readStringProperty(value, "partNumber");
  const stageId = readStringProperty(value, "stageId");
  const parsedPartNumber =
    partNumber !== null ? parseSafePositiveInteger(partNumber) : null;
  if (stageId === null || !isUuidString(stageId) || parsedPartNumber === null) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return { partNumber: parsedPartNumber, stageId };
}

function registerInitiateRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: MultipartBlobStageRouteDeps,
): void {
  route.on(
    initiateMultipartBlobStageOperation.method,
    operationRoutePath(initiateMultipartBlobStageOperation),
    requireAuth,
    jsonRequestValidator(initiateMultipartBlobStageOperation.body),
    async (c) => {
      const session = c.get("session");

      try {
        return c.json<InitiateMultipartBlobStageResponse>(
          await initiateMultipartBlobStage(runtime, {
            ...c.req.valid("json"),
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof MultipartBlobStageError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

function registerStatusRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: MultipartBlobStageRouteDeps,
): void {
  route.on(
    getMultipartBlobStageOperation.method,
    operationRoutePath(getMultipartBlobStageOperation),
    requireAuth,
    pathParamsValidator(getMultipartBlobStageOperation.params),
    async (c) => {
      const session = c.get("session");
      const { stageId } = c.req.valid("param");

      try {
        return c.json<MultipartBlobStageStatusResponse>(
          await getMultipartBlobStage(runtime, {
            stageId,
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof MultipartBlobStageError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

function registerPartBytesRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: MultipartBlobStageRouteDeps,
): void {
  route.put(
    "/blobs/stages/multipart/:stageId/parts/:partNumber/bytes",
    requireAuth,
    validator("param", validatePartRouteParams),
    async (c) => {
      const byteLength = parseSafePositiveInteger(
        c.req.header(BLOB_PART_BYTE_LENGTH_HEADER) ?? null,
      );
      const sha256 = c.req.header(BLOB_PART_SHA256_HEADER) ?? null;
      const uploadId = c.req.header(BLOB_PART_UPLOAD_ID_HEADER);
      // Reject an over-declared part before buffering its body: the server-level
      // maxRequestBodySize bounds the actual bytes, and this bounds the declared
      // length so an absurd Content-Length header fails fast without an
      // allocation, ahead of the store's own ceiling check on the buffered bytes.
      if (
        byteLength === null ||
        byteLength > MAX_UPLOAD_PART_BYTES ||
        !isSha256HexString(sha256) ||
        !uploadId
      ) {
        return c.json({ error: "Invalid request" }, 400);
      }

      // Read the part body with Bun's native body consumption instead of a
      // hand-rolled ReadableStream reader over c.req.raw.body. That reader trips
      // a Bun native request-stream defect that failed a fraction of part reads
      // behind the ingress tunnel (and segfaulted the process before the body
      // was buffered); arrayBuffer() consumes the body without that JS reader.
      const bytes = new Uint8Array(await c.req.arrayBuffer());

      const session = c.get("session");
      const { partNumber, stageId } = c.req.valid("param");

      try {
        return c.json<UploadMultipartBlobPartResponse>(
          await uploadMultipartBlobPartBytes(runtime, {
            byteLength,
            bytes,
            partNumber,
            sha256,
            stageId,
            uploadId,
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof MultipartBlobStageError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

function registerCompleteRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: MultipartBlobStageRouteDeps,
): void {
  route.on(
    completeMultipartBlobStageOperation.method,
    operationRoutePath(completeMultipartBlobStageOperation),
    requireAuth,
    pathParamsValidator(completeMultipartBlobStageOperation.params),
    jsonRequestValidator(completeMultipartBlobStageOperation.body),
    async (c) => {
      const session = c.get("session");
      const { stageId } = c.req.valid("param");

      try {
        return c.json<CompleteMultipartBlobStageResponse>(
          await completeMultipartBlobStage(runtime, {
            ...c.req.valid("json"),
            stageId,
            userId: session.userId,
          }),
        );
      } catch (error) {
        if (error instanceof MultipartBlobStageError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

export function createMultipartBlobStageRoute(
  deps: MultipartBlobStageRouteDeps,
) {
  const route = new Hono<SessionEnv>();

  registerInitiateRoute(route, deps);
  registerStatusRoute(route, deps);
  registerPartBytesRoute(route, deps);
  registerCompleteRoute(route, deps);

  return route;
}
