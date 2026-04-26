import type { AccessEventTypeV2 } from "@tearleads/crypto";
import {
  type ContainerV2MutationRequest,
  isContainerV2MutationRequest,
} from "@tearleads/validators/request";
import type { ContainerV2MutationResponse } from "@tearleads/validators/response";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  ContainerV2MutationError,
  mutateContainerV2,
} from "../../services/containers/v2Mutations";
import type { ApiServiceRuntime } from "../../services/runtime";

interface ContainerV2MutationsRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

interface JsonValidationContext {
  json: (body: { readonly error: string }, status: 400) => Response;
}

interface AddContainerV2MutationRouteInput
  extends ContainerV2MutationsRouteDeps {
  readonly expectedEventType: AccessEventTypeV2;
  readonly getExpectedContainerId?: (c: Context<SessionEnv>) => string;
  readonly path: string;
  readonly route: Hono<SessionEnv>;
}

function validateContainerV2MutationRequest(
  value: unknown,
  c: JsonValidationContext,
) {
  if (!isContainerV2MutationRequest(value)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return value;
}

function addContainerV2MutationRoute({
  expectedEventType,
  getExpectedContainerId,
  path,
  requireAuth,
  route,
  runtime,
}: AddContainerV2MutationRouteInput) {
  route.post(
    path,
    requireAuth,
    validator("json", validateContainerV2MutationRequest),
    async (c) => {
      const session = c.get("session");

      try {
        return c.json<ContainerV2MutationResponse>(
          await mutateContainerV2(runtime, {
            expectedEventType,
            fingerprint: session.fingerprint,
            request: c.req.valid("json") as ContainerV2MutationRequest,
            userId: session.userId,
            ...(getExpectedContainerId
              ? { expectedContainerId: getExpectedContainerId(c) }
              : {}),
          }),
        );
      } catch (error) {
        if (error instanceof ContainerV2MutationError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

export function createContainerV2MutationsRoute({
  requireAuth,
  runtime,
}: ContainerV2MutationsRouteDeps) {
  const route = new Hono<SessionEnv>();
  const routeDeps = { requireAuth, route, runtime };

  addContainerV2MutationRoute({
    ...routeDeps,
    expectedEventType: "container.create",
    path: "/v2/containers",
  });
  addContainerV2MutationRoute({
    ...routeDeps,
    expectedEventType: "container.grant",
    getExpectedContainerId: (c) => c.req.param("containerId"),
    path: "/v2/containers/:containerId/share",
  });
  addContainerV2MutationRoute({
    ...routeDeps,
    expectedEventType: "container.revoke",
    getExpectedContainerId: (c) => c.req.param("containerId"),
    path: "/v2/containers/:containerId/revoke",
  });
  addContainerV2MutationRoute({
    ...routeDeps,
    expectedEventType: "container.move",
    getExpectedContainerId: (c) => c.req.param("containerId"),
    path: "/v2/containers/:containerId/move",
  });

  return route;
}
