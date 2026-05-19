import {
  isCompleteMultipartBlobStageRequest,
  isInitiateMultipartBlobStageRequest,
  isUploadMultipartBlobPartRequest,
} from "@tearleads/validators/request";
import type {
  CompleteMultipartBlobStageResponse,
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
  UploadMultipartBlobPartResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  completeMultipartBlobStage,
  getMultipartBlobStage,
  initiateMultipartBlobStage,
  MultipartBlobStageError,
  uploadMultipartBlobPart,
  uploadMultipartBlobPartStream,
} from "../../services/blobs/multipartStage";
import type { ApiServiceRuntime } from "../../services/runtime";

const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
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

function isUuidString(value: string): boolean {
  return new RegExp(UUID_PATTERN).test(value);
}

function createRequestValidator<T>(isRequest: (value: unknown) => value is T) {
  return (value: unknown, c: JsonValidationContext): T | Response => {
    if (!isRequest(value)) {
      return c.json({ error: "Invalid request" }, 400);
    }

    return value;
  };
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSafePositiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isSha256Hex(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{64}$/u.test(value);
}

function validatePartRouteParams(
  value: unknown,
  c: JsonValidationContext,
): MultipartBlobPartParams | Response {
  const { partNumber, stageId } = value as {
    partNumber?: string;
    stageId?: string;
  };
  const parsedPartNumber =
    typeof partNumber === "string" ? parsePositiveInteger(partNumber) : null;
  if (
    typeof stageId !== "string" ||
    !isUuidString(stageId) ||
    parsedPartNumber === null
  ) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return { partNumber: parsedPartNumber, stageId };
}

function registerInitiateRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: MultipartBlobStageRouteDeps,
): void {
  route.post(
    "/blobs/stages/multipart",
    requireAuth,
    validator(
      "json",
      createRequestValidator(isInitiateMultipartBlobStageRequest),
    ),
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
  route.get(
    "/blobs/stages/multipart/:stageId",
    requireAuth,
    validator("param", (value, c) => {
      const { stageId } = value as { stageId?: string };
      if (typeof stageId !== "string" || !isUuidString(stageId)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return { stageId };
    }),
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

function registerPartRoute(
  route: Hono<SessionEnv>,
  deps: MultipartBlobStageRouteDeps,
): void {
  registerJsonPartRoute(route, deps);
  registerPartBytesRoute(route, deps);
}

function registerJsonPartRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: MultipartBlobStageRouteDeps,
): void {
  route.put(
    "/blobs/stages/multipart/:stageId/parts/:partNumber",
    requireAuth,
    validator("param", validatePartRouteParams),
    validator("json", createRequestValidator(isUploadMultipartBlobPartRequest)),
    async (c) => {
      const session = c.get("session");
      const { partNumber, stageId } = c.req.valid("param");

      try {
        return c.json<UploadMultipartBlobPartResponse>(
          await uploadMultipartBlobPart(runtime, {
            ...c.req.valid("json"),
            partNumber,
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
      const stream = c.req.raw.body;
      if (
        byteLength === null ||
        !isSha256Hex(sha256) ||
        !uploadId ||
        stream === null
      ) {
        return c.json({ error: "Invalid request" }, 400);
      }

      const session = c.get("session");
      const { partNumber, stageId } = c.req.valid("param");

      try {
        return c.json<UploadMultipartBlobPartResponse>(
          await uploadMultipartBlobPartStream(runtime, {
            byteLength,
            partNumber,
            sha256,
            stageId,
            stream,
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
  route.post(
    "/blobs/stages/multipart/:stageId/complete",
    requireAuth,
    validator("param", (value, c) => {
      const { stageId } = value as { stageId?: string };
      if (typeof stageId !== "string" || !isUuidString(stageId)) {
        return c.json({ error: "Invalid request" }, 400);
      }

      return { stageId };
    }),
    validator(
      "json",
      createRequestValidator(isCompleteMultipartBlobStageRequest),
    ),
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
  registerPartRoute(route, deps);
  registerCompleteRoute(route, deps);

  return route;
}
