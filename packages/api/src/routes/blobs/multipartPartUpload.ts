import {
  authorizeMultipartBlobPartUploadOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import { Hono, type MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { authorizeMultipartBlobPartUpload } from "../../services/blobs/multipartPartUpload";
import { MultipartBlobStageError } from "../../services/blobs/multipartStageAccess";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

export function createMultipartPartUploadRoute(input: {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}) {
  const route = new Hono();
  const operation = authorizeMultipartBlobPartUploadOperation;
  route.on(
    operation.method,
    operationRoutePath(operation),
    input.requireAuth,
    pathParamsValidator(operation.params),
    jsonRequestValidator(operation.body),
    async (c) => {
      c.header("Cache-Control", "no-store");
      try {
        const params = c.req.valid("param");
        return c.json(
          await authorizeMultipartBlobPartUpload(input.runtime, {
            ...c.req.valid("json"),
            stageId: params.stageId,
            partNumber: Number(params.partNumber),
            userId: c.get("session").userId,
          }),
        );
      } catch (error) {
        return respondToStatusError(c, error, MultipartBlobStageError);
      }
    },
  );
  return route;
}
