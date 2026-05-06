import type { AccessEventType } from "@tearleads/crypto";
import {
  type ContainerMutationRequest,
  isContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerDeleteResponse,
  ContainerMutationResponse,
} from "@tearleads/validators/response";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  DeleteContainerError,
  deleteContainer,
} from "../../services/containers/deleteContainer";
import {
  ContainerMutationError,
  mutateContainer,
} from "../../services/containers/mutations";
import type { ApiServiceRuntime } from "../../services/runtime";

interface ContainerMutationsRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

interface JsonValidationContext {
  json: (body: { readonly error: string }, status: 400) => Response;
}

interface AddContainerMutationRouteInput extends ContainerMutationsRouteDeps {
  readonly expectedEventType: AccessEventType;
  readonly getExpectedContainerId?: (c: Context<SessionEnv>) => string;
  readonly path: string;
  readonly route: Hono<SessionEnv>;
}

function validateContainerMutationRequest(
  value: unknown,
  c: JsonValidationContext,
) {
  if (!isContainerMutationRequest(value)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return value;
}

function addContainerMutationRoute({
  expectedEventType,
  getExpectedContainerId,
  path,
  requireAuth,
  route,
  runtime,
}: AddContainerMutationRouteInput) {
  route.post(
    path,
    requireAuth,
    validator("json", validateContainerMutationRequest),
    async (c) => {
      const session = c.get("session");

      try {
        return c.json<ContainerMutationResponse>(
          await mutateContainer(runtime, {
            expectedEventType,
            fingerprint: session.fingerprint,
            request: c.req.valid("json") as ContainerMutationRequest,
            userId: session.userId,
            ...(getExpectedContainerId
              ? { expectedContainerId: getExpectedContainerId(c) }
              : {}),
          }),
        );
      } catch (error) {
        if (error instanceof ContainerMutationError) {
          return c.json({ error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

export function createContainerMutationsRoute({
  requireAuth,
  runtime,
}: ContainerMutationsRouteDeps) {
  const route = new Hono<SessionEnv>();
  const routeDeps = { requireAuth, route, runtime };

  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.create",
    path: "/containers",
  });
  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.grant",
    getExpectedContainerId: (c) => c.req.param("containerId"),
    path: "/containers/:containerId/share",
  });
  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.revoke",
    getExpectedContainerId: (c) => c.req.param("containerId"),
    path: "/containers/:containerId/revoke",
  });
  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.rekey",
    getExpectedContainerId: (c) => c.req.param("containerId"),
    path: "/containers/:containerId/rekey",
  });
  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.move",
    getExpectedContainerId: (c) => c.req.param("containerId"),
    path: "/containers/:containerId/move",
  });
  route.delete("/containers/:containerId", requireAuth, async (c) => {
    const session = c.get("session");

    try {
      return c.json<ContainerDeleteResponse>(
        await deleteContainer(runtime, {
          containerId: c.req.param("containerId"),
          userId: session.userId,
        }),
      );
    } catch (error) {
      if (error instanceof DeleteContainerError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  });

  return route;
}
