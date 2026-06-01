import type { AccessEventType } from "@tearleads/crypto";
import {
  type ContainerCreateWithMetadataDocumentRequest,
  type ContainerMutationRequest,
  isContainerCreateWithMetadataDocumentRequest,
  isContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
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
  createContainerWithMetadataDocument,
  DocumentMutationError,
  mutateContainer,
} from "../../services/containers/mutations";
import type { ApiServiceRuntime } from "../../services/runtime";

interface ContainerMutationsRouteDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
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

interface ContainerMutationBodyCandidate {
  readonly eventType?: unknown;
  readonly parentContainerId?: unknown;
  readonly signerKeyFingerprint?: unknown;
  readonly state?: unknown;
}

function isRecord(value: unknown): value is ContainerMutationBodyCandidate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readContainerMutationBodyEventType(
  request: ContainerMutationRequest,
): AccessEventType | null {
  if (!isRecord(request.body)) {
    return null;
  }

  const eventType = request.body.eventType;
  return typeof eventType === "string" ? (eventType as AccessEventType) : null;
}

function readContainerMutationSignerKeyFingerprint(
  request: ContainerMutationRequest,
): string | undefined {
  if (!isRecord(request.event)) {
    return undefined;
  }

  const event = request.event as ContainerMutationBodyCandidate;
  return readNonEmptyString(event.signerKeyFingerprint);
}

function readContainerMutationPreviousParentId(
  request: ContainerMutationRequest,
): string | null | undefined {
  if (
    !isRecord(request.previousManifest) ||
    !isRecord(request.previousManifest.state)
  ) {
    return undefined;
  }

  const previousState = request.previousManifest
    .state as ContainerMutationBodyCandidate;
  return readNullableString(previousState.parentContainerId);
}

async function publishContainerMutationCreated(input: {
  readonly expectedEventType: AccessEventType;
  readonly publish: ContainerMutationsRouteDeps["publish"];
  readonly request: ContainerMutationRequest;
  readonly response: ContainerMutationResponse;
}) {
  const previousParentId = readContainerMutationPreviousParentId(input.request);
  const signerKeyFingerprint = readContainerMutationSignerKeyFingerprint(
    input.request,
  );

  await input.publish({
    type: "container_mutation_created",
    containerId: input.response.containerId,
    eventType:
      readContainerMutationBodyEventType(input.request) ??
      input.expectedEventType,
    parentId: input.response.parentId,
    ...(previousParentId === undefined ? {} : { previousParentId }),
    ...(signerKeyFingerprint === undefined ? {} : { signerKeyFingerprint }),
    updatedAt: input.response.updatedAt,
  });
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

function validateContainerCreateWithMetadataDocumentRequest(
  value: unknown,
  c: JsonValidationContext,
) {
  if (!isContainerCreateWithMetadataDocumentRequest(value)) {
    return c.json({ error: "Invalid request" }, 400);
  }

  return value;
}

function handleContainerMetadataCreateError(error: unknown) {
  if (
    error instanceof ContainerMutationError ||
    error instanceof DocumentMutationError
  ) {
    return { error: error.message, status: error.status };
  }

  return null;
}

function addContainerMutationRoute({
  expectedEventType,
  getExpectedContainerId,
  path,
  publish,
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
        const request = c.req.valid("json");
        const response = await mutateContainer(runtime, {
          expectedEventType,
          fingerprint: session.fingerprint,
          request,
          userId: session.userId,
          ...(getExpectedContainerId
            ? { expectedContainerId: getExpectedContainerId(c) }
            : {}),
        });
        await publishContainerMutationCreated({
          expectedEventType,
          publish,
          request,
          response,
        });

        return c.json<ContainerMutationResponse>(response);
      } catch (error) {
        if (error instanceof ContainerMutationError) {
          return c.json({ error: error.message }, error.status);
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
  readonly userId: string;
}): Promise<ContainerCreateWithMetadataDocumentResponse> {
  const response = await createContainerWithMetadataDocument(input.runtime, {
    fingerprint: input.fingerprint,
    request: input.request,
    userId: input.userId,
  });
  await publishContainerMutationCreated({
    expectedEventType: "container.create",
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

  route.post(
    "/containers/with-metadata-document",
    requireAuth,
    validator("json", validateContainerCreateWithMetadataDocumentRequest),
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
            userId: session.userId,
          }),
        );
      } catch (error) {
        const mutationError = handleContainerMetadataCreateError(error);
        if (mutationError) {
          return c.json({ error: mutationError.error }, mutationError.status);
        }

        throw error;
      }
    },
  );

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
