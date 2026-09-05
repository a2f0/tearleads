import {
  operationRoutePath,
  reciteContainerOperation,
} from "@tearleads/validators/operation";
import type { ContainerReciteResponse } from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import {
  ContainerMutationError,
  reciteContainer,
} from "../../services/containers/mutations";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { publishContainerMutationCreated } from "./mutationEvents";

export function createContainerReciteRoute(input: {
  readonly publish: (event: PublishedRealtimeEvent) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}) {
  const route = new Hono<SessionEnv>();
  const operation = reciteContainerOperation;
  route.on(
    operation.method,
    operationRoutePath(operation),
    input.requireAuth,
    jsonRequestValidator(operation.body),
    pathParamsValidator(operation.params),
    async (c) => {
      const session = c.get("session");
      try {
        const request = c.req.valid("json");
        const response = await reciteContainer(input.runtime, {
          expectedContainerId: c.req.valid("param").containerId,
          fingerprint: session.fingerprint,
          request,
          userId: session.userId,
        });
        await publishContainerMutationCreated({
          expectedEventType: "container.recite",
          origin: { sessionId: session.id, userId: session.userId },
          publish: input.publish,
          request,
          response,
        });
        return c.json<ContainerReciteResponse>(response);
      } catch (error) {
        if (error instanceof ContainerMutationError)
          return c.json(error.body ?? { error: error.message }, error.status);
        throw error;
      }
    },
  );
  return route;
}
