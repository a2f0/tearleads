import type { AccessEventType } from "@tearleads/crypto";
import {
  type ContainerMutationPathParams,
  createContainerOperation,
  createContainerWithMetadataDocumentOperation,
  deleteContainerOperation,
  moveContainerOperation,
  operationRoutePath,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
} from "@tearleads/validators/operation";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ContainerCreateWithMetadataDocumentResponse,
  type ContainerDeleteResponse,
  type ContainerMutationResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionEnv } from "../../middleware/session";
import {
  DeleteContainerError,
  deleteContainer,
} from "../../services/containers/deleteContainer";
import {
  ContainerMutationError,
  createContainerWithMetadataDocument,
  mutateContainer,
} from "../../services/containers/mutations";
import type { ApiServiceRuntime } from "../../services/runtime";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";
import { publishContainerMutationCreated } from "./mutationEvents";

interface ContainerMutationsRouteDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

type ContainerMutationOperation =
  | typeof createContainerOperation
  | typeof moveContainerOperation
  | typeof rekeyContainerOperation
  | typeof revokeContainerOperation
  | typeof shareContainerOperation;

type ContainerMutationRouteParams =
  | Record<string, never>
  | ContainerMutationPathParams;

interface AddContainerMutationRouteInput extends ContainerMutationsRouteDeps {
  readonly expectedEventType: AccessEventType;
  readonly operation: ContainerMutationOperation;
  readonly route: Hono<SessionEnv>;
}

function handleContainerMetadataCreateError(error: unknown) {
  if (error instanceof ContainerMutationError) {
    return {
      body: error.body ?? { error: error.message },
      status: error.status,
    };
  }

  return null;
}

function addContainerMutationRoute({
  expectedEventType,
  operation,
  publish,
  requireAuth,
  route,
  runtime,
}: AddContainerMutationRouteInput) {
  route.on(
    operation.method,
    operationRoutePath(operation),
    requireAuth,
    jsonRequestValidator(operation.body),
    pathParamsValidator<ContainerMutationRouteParams>(operation.params),
    async (c) => {
      const session = c.get("session");

      try {
        const params = c.req.valid("param");
        const request = c.req.valid("json");
        const expectedContainerId =
          "containerId" in params ? params.containerId : undefined;
        const response = await mutateContainer(runtime, {
          expectedEventType,
          fingerprint: session.fingerprint,
          request,
          userId: session.userId,
          ...(expectedContainerId === undefined ? {} : { expectedContainerId }),
        });
        await publishContainerMutationCreated({
          expectedEventType,
          origin: { sessionId: session.id, userId: session.userId },
          publish,
          request,
          response,
        });

        return c.json<ContainerMutationResponse>(response);
      } catch (error) {
        if (error instanceof ContainerMutationError) {
          return c.json(error.body ?? { error: error.message }, error.status);
        }

        throw error;
      }
    },
  );
}

async function createContainerWithMetadataDocumentResponse(input: {
  readonly fingerprint: string;
  readonly publish: ContainerMutationsRouteDeps["publish"];
  readonly request: ContainerCreateWithMetadataDocumentRequest;
  readonly runtime: ApiServiceRuntime;
  readonly sessionId: string;
  readonly userId: string;
}): Promise<ContainerCreateWithMetadataDocumentResponse> {
  const response = await createContainerWithMetadataDocument(input.runtime, {
    fingerprint: input.fingerprint,
    request: input.request,
    userId: input.userId,
  });
  await publishContainerMutationCreated({
    expectedEventType: "container.create",
    origin: { sessionId: input.sessionId, userId: input.userId },
    publish: input.publish,
    request: input.request.container,
    response: response.container,
  });

  return response;
}

export function createContainerMutationsRoute({
  publish,
  requireAuth,
  runtime,
}: ContainerMutationsRouteDeps) {
  const route = new Hono<SessionEnv>();
  const routeDeps = { publish, requireAuth, route, runtime };

  route.on(
    createContainerWithMetadataDocumentOperation.method,
    operationRoutePath(createContainerWithMetadataDocumentOperation),
    requireAuth,
    jsonRequestValidator(createContainerWithMetadataDocumentOperation.body),
    async (c) => {
      const session = c.get("session");

      try {
        const request = c.req.valid("json");
        return c.json<ContainerCreateWithMetadataDocumentResponse>(
          await createContainerWithMetadataDocumentResponse({
            fingerprint: session.fingerprint,
            publish,
            request,
            runtime,
            sessionId: session.id,
            userId: session.userId,
          }),
        );
      } catch (error) {
        const mutationError = handleContainerMetadataCreateError(error);
        if (mutationError) {
          return c.json(mutationError.body, mutationError.status);
        }

        throw error;
      }
    },
  );

  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.create",
    operation: createContainerOperation,
  });
  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.grant",
    operation: shareContainerOperation,
  });
  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.revoke",
    operation: revokeContainerOperation,
  });
  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.rekey",
    operation: rekeyContainerOperation,
  });
  addContainerMutationRoute({
    ...routeDeps,
    expectedEventType: "container.move",
    operation: moveContainerOperation,
  });
  route.on(
    deleteContainerOperation.method,
    operationRoutePath(deleteContainerOperation),
    requireAuth,
    pathParamsValidator(deleteContainerOperation.params),
    async (c) => {
      const session = c.get("session");
      const { containerId } = c.req.valid("param");

      try {
        const response = await deleteContainer(runtime, {
          containerId,
          userId: session.userId,
        });
        // The container is gone; interested sockets must resync (and drop it).
        // Best-effort: the delete is already committed, so a publish failure
        // must not turn it into a 500 (the missed resync is recovered by HTTP
        // sync).
        try {
          await publish({ type: "access_changed", containerId });
        } catch (publishError) {
          console.error(
            "Failed to publish container delete access_changed:",
            publishError,
          );
        }
        return c.json<ContainerDeleteResponse>(response);
      } catch (error) {
        return respondToStatusError(c, error, DeleteContainerError, {
          code: CONTAINER_NOT_FOUND_ERROR_CODE,
          status: 404,
        });
      }
    },
  );

  return route;
}
