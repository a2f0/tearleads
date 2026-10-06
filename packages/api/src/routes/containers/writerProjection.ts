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
import {
  PrincipalHistoryContinuation,
  PrincipalPolicyError,
} from "../../services/principals/shared";
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
        if (error instanceof PrincipalHistoryContinuation)
          return c.json(
            {
              code: error.code,
              committed: false,
              progressToken: error.progressToken,
            },
            202,
          );
        if (error instanceof PrincipalPolicyError && error.status !== 500)
          // A missing principal dependency does not mean this object was deleted.
          return c.json(
            { error: error.message },
            error.status === 404 ? 409 : error.status,
          );
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
