import {
  getContainerWriterProjectionOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  ContainerWriterProjectionError,
  getContainerWriterProjection,
} from "../../services/containers/writerProjection";
import type { ApiServiceRuntime } from "../../services/runtime";
import { headersValidator } from "../../validators/headers";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

interface ContainerWriterProjectionRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

export function createContainerWriterProjectionRoute({
  requireAuth,
  runtime,
}: ContainerWriterProjectionRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.on(
    getContainerWriterProjectionOperation.method,
    operationRoutePath(getContainerWriterProjectionOperation),
    requireAuth,
    pathParamsValidator(getContainerWriterProjectionOperation.params),
    headersValidator(getContainerWriterProjectionOperation.headers),
    async (c) => {
      c.env?.beginPrincipalHistoryVerification?.();
      const { containerId } = c.req.valid("param");
      const session = c.get("session");

      c.header("Cache-Control", "no-store");
      try {
        return c.json<ContainerWriterProjectionResponse>(
          await getContainerWriterProjection(runtime, {
            containerId,
            userId: session.userId,
            historyPrefixes: c.req.valid("header")["x-projection-history"],
          }),
        );
      } catch (error) {
        return respondToStatusError(
          c,
          error,
          ContainerWriterProjectionError,
          error instanceof ContainerWriterProjectionError &&
            error.code !== undefined
            ? {
                code: error.code,
                status: error.status,
              }
            : undefined,
        );
      }
    },
  );

  return route;
}
