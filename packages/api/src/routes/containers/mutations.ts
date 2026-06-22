import type { AccessEventType } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
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
  mutateContainer,
} from "../../services/containers/mutations";
import type { ApiServiceRuntime } from "../../services/runtime";

interface ContainerMutationsRouteDeps {
  readonly publish: (event: Record<string, unknown>) => Promise<void>;
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

interface ErrorResponseBody {
  readonly error: string;
}

interface JsonValidationContext {
  json: (body: ErrorResponseBody, status: 400) => Response;
}

interface AddContainerMutationRouteInput extends ContainerMutationsRouteDeps {
  readonly expectedEventType: AccessEventType;
  readonly getExpectedContainerId?: (c: Context<SessionEnv>) => string;
  readonly path: string;
  readonly route: Hono<SessionEnv>;
}

interface ContainerMutationBodyCandidate {
  readonly eventType?: unknown;
}

function isContainerMutationBodyCandidate(
  value: unknown,
): value is ContainerMutationBodyCandidate {
  return isPlainObject(value);
}

function readRecordValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return record[key];
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

function isAccessEventType(value: unknown): value is AccessEventType {
  return (
    value === "attachment.bind" ||
    value === "attachment.detach" ||
    value === "container.create" ||
    value === "container.grant" ||
    value === "container.move" ||
    value === "container.rekey" ||
    value === "container.revoke" ||
    value === "document.link" ||
    value === "document.unlink"
  );
}

function readContainerMutationBodyEventType(
  request: ContainerMutationRequest,
): AccessEventType | null {
  if (!isContainerMutationBodyCandidate(request.body)) {
    return null;
  }

  const eventType = request.body.eventType;
  return isAccessEventType(eventType) ? eventType : null;
}

function readSignerKeyFingerprintFromEvent(event: unknown): string | undefined {
  if (!isPlainObject(event)) {
    return undefined;
  }

  return readNonEmptyString(readRecordValue(event, "signerKeyFingerprint"));
}

function readPreviousParentIdFromManifest(
  previousManifest: unknown,
): string | null | undefined {
  if (!isPlainObject(previousManifest)) {
    return undefined;
  }

  const previousState = readRecordValue(previousManifest, "state");
  if (!isPlainObject(previousState)) {
    return undefined;
  }

  return readNullableString(
    readRecordValue(previousState, "parentContainerId"),
  );
}

function readContainerMutationSignerKeyFingerprint(
  request: ContainerMutationRequest,
): string | undefined {
  return readSignerKeyFingerprintFromEvent(request.event);
}

function readContainerMutationPreviousParentId(
  request: ContainerMutationRequest,
): string | null | undefined {
  return readPreviousParentIdFromManifest(request.previousManifest);
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
  const eventType =
    readContainerMutationBodyEventType(input.request) ??
    input.expectedEventType;

  await input.publish({
    type: "container_mutation_created",
    containerId: input.response.containerId,
    eventType,
    parentId: input.response.parentId,
    ...(previousParentId === undefined ? {} : { previousParentId }),
    ...(signerKeyFingerprint === undefined ? {} : { signerKeyFingerprint }),
    updatedAt: input.response.updatedAt,
  });

  // Everything but a plain create changes who can read the container or rotates
  // its key epoch, so tell sockets interested in it to resync their access (and
  // drop stale interest) before they receive further scoped events.
  if (eventType !== "container.create") {
    await input.publish({
      type: "access_changed",
      containerId: input.response.containerId,
    });
  }
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
          return c.json(mutationError.body, mutationError.status);
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
    const containerId = c.req.param("containerId");

    try {
      const response = await deleteContainer(runtime, {
        containerId,
        userId: session.userId,
      });
      // The container is gone; interested sockets must resync (and drop it).
      // Best-effort: the delete is already committed, so a publish failure must
      // not turn it into a 500 (the missed resync is recovered by HTTP sync).
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
      if (error instanceof DeleteContainerError) {
        return c.json({ error: error.message }, error.status);
      }

      throw error;
    }
  });

  return route;
}
