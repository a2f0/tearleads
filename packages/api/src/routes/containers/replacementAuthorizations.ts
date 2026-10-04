import {
  getContainerReplacementAuthorizationsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import { Hono, type MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import { getContainerReplacementAuthorizations } from "../../services/containers/replacementAuthorizations";
import { ContainerWriterProjectionError } from "../../services/containers/writerProjection";
import type { ApiServiceRuntime } from "../../services/runtime";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

export function createContainerReplacementAuthorizationsRoute(input: {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}) {
  const route = new Hono<SessionEnv>();
  const operation = getContainerReplacementAuthorizationsOperation;
  route.on(
    operation.method,
    operationRoutePath(operation),
    input.requireAuth,
    pathParamsValidator(operation.params),
    async (c) => {
      try {
        return c.json(
          await getContainerReplacementAuthorizations(input.runtime, {
            ...c.req.valid("param"),
            userId: c.get("session").userId,
          }),
        );
      } catch (error) {
        return respondToStatusError(c, error, ContainerWriterProjectionError);
      }
    },
  );
  return route;
}
