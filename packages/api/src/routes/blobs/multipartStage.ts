import {
  blobWireHeaderKeys,
  completeMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
  operationRoutePath,
  uploadMultipartBlobPartBytesOperation,
} from "@tearleads/validators/operation";
import type {
  CompleteMultipartBlobStageResponse,
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
  UploadMultipartBlobPartResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  completeMultipartBlobStage,
  getMultipartBlobStage,
  initiateMultipartBlobStage,
  MultipartBlobStageError,
  uploadMultipartBlobPartBytes,
} from "../../services/blobs/multipartStage";
import type { ApiServiceRuntime } from "../../services/runtime";
import { headersValidator } from "../../validators/headers";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

interface MultipartBlobStageRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
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
        return respondToStatusError(c, error, MultipartBlobStageError);
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
        return respondToStatusError(
          c,
          error,
          MultipartBlobStageError,
          error instanceof MultipartBlobStageError && error.code !== undefined
            ? { code: error.code, status: error.status }
            : undefined,
        );
      }
    },
  );
}

function registerPartBytesRoute(
  route: Hono<SessionEnv>,
  { requireAuth, runtime }: MultipartBlobStageRouteDeps,
): void {
  route.on(
    uploadMultipartBlobPartBytesOperation.method,
    operationRoutePath(uploadMultipartBlobPartBytesOperation),
    requireAuth,
    pathParamsValidator(uploadMultipartBlobPartBytesOperation.params),
    headersValidator(uploadMultipartBlobPartBytesOperation.headers),
    async (c) => {
      const headers = c.req.valid("header");
      const byteLength = Number(headers[blobWireHeaderKeys.partByteLength]);
      const sha256 = headers[blobWireHeaderKeys.partSha256];
      const uploadId = headers[blobWireHeaderKeys.partUploadId];

      // Read the part body with Bun's native body consumption instead of a
      // hand-rolled ReadableStream reader over c.req.raw.body. That reader trips
      // a Bun native request-stream defect that failed a fraction of part reads
      // behind the ingress tunnel (and segfaulted the process before the body
      // was buffered); arrayBuffer() consumes the body without that JS reader.
      const bodyResult = uploadMultipartBlobPartBytesOperation.body.safeParse(
        new Uint8Array(await c.req.arrayBuffer()),
      );
      if (!bodyResult.success) {
        return c.json({ error: "Invalid request" }, 400);
      }
      const bytes = bodyResult.data;

      const session = c.get("session");
      const params = c.req.valid("param");
      const partNumber = Number(params.partNumber);
      const { stageId } = params;

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
        return respondToStatusError(c, error, MultipartBlobStageError);
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
        return respondToStatusError(c, error, MultipartBlobStageError);
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
