import type { AccessEventType } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
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
import type {
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  ContainerDeleteResponse,
  ContainerMutationResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { isAccessEventType } from "../../keyingProjectionRecords";
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
import { publishBestEffort } from "../../utils/publishBestEffort";
import { jsonRequestValidator } from "../../validators/jsonRequest";
import { pathParamsValidator } from "../../validators/pathParams";
import { respondToStatusError } from "../errorResponse";

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

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readContainerMutationBodyEventType(
  request: ContainerMutationRequest,
): AccessEventType | null {
  if (!isPlainObject(request.body)) {
    return null;
  }

  const eventType = Reflect.get(request.body, "eventType");
  return isAccessEventType(eventType) ? eventType : null;
}

function readContainerMutationPreviousParentId(
  request: ContainerMutationRequest,
): string | null | undefined {
  const previousState = request.previousManifest?.state;
  if (!previousState) {
    return undefined;
  }

  return readNullableString(Reflect.get(previousState, "parentContainerId"));
}

// A grant to a single user names its recipient in the request body. That
// recipient hasn't declared interest in this container yet (they don't know it
// exists), so the container-scoped access_changed below never reaches them; the
// recipient id lets us additionally route a user-scoped resync to their own
// sockets. Group grants fan out to members and are left to the
// next manual/periodic resync.
function readGrantUserRecipientId(
  request: ContainerMutationRequest,
): string | null {
  if (!isPlainObject(request.body)) {
    return null;
  }
  const grant = Reflect.get(request.body, "grant");
  if (!isPlainObject(grant)) {
    return null;
  }
  const subjectType = Reflect.get(grant, "subjectType");
  const subjectId = Reflect.get(grant, "subjectId");
  return subjectType === "user" &&
    typeof subjectId === "string" &&
    subjectId.length > 0
    ? subjectId
    : null;
}

export async function publishContainerMutationCreated(input: {
  readonly expectedEventType: AccessEventType;
  readonly origin: { readonly sessionId: string; readonly userId: string };
  readonly publish: ContainerMutationsRouteDeps["publish"];
  readonly request: ContainerMutationRequest;
  readonly response: ContainerMutationResponse;
}) {
  const previousParentId = readContainerMutationPreviousParentId(input.request);
  const eventType =
    readContainerMutationBodyEventType(input.request) ??
    input.expectedEventType;

  await publishBestEffort(
    input.publish,
    {
      type: "container_mutation_created",
      containerId: input.response.containerId,
      eventType,
      // Tag the event with the authoring session so the ws router skips echoing it
      // back over this exact socket, while still delivering to every OTHER session
      // of the same identity (e.g. a recovered peer) so they re-list the affected
      // parent lane and surface the new/moved container. This mirrors the document
      // mutation path; the router strips `origin` before forwarding to clients.
      // Excluding by identity signing fingerprint instead — as the client used to
      // — wrongly suppressed a sibling peer's create, since both peers derive the
      // same signing key from the shared seed phrase.
      origin: input.origin,
      parentId: input.response.parentId,
      ...(previousParentId === undefined ? {} : { previousParentId }),
      updatedAt: input.response.updatedAt,
    },
    "container mutation notification",
  );

  // Everything but a plain create changes who can read the container or rotates
  // its key epoch, so tell sockets interested in it to resync their access (and
  // drop stale interest) before they receive further scoped events.
  if (eventType !== "container.create") {
    await publishBestEffort(
      input.publish,
      { type: "access_changed", containerId: input.response.containerId },
      "container mutation notification",
    );
  }

  // access_changed only reaches sockets already interested in this container. A
  // brand-new share is for a container the recipient hasn't declared interest
  // in (they don't know it exists yet), so it would otherwise stay invisible
  // until they manually refresh. A scopeless, user-scoped event routes to that
  // user's own sockets and tells their client to re-list root containers.
  if (eventType === "container.grant") {
    const recipientUserId = readGrantUserRecipientId(input.request);
    if (recipientUserId) {
      await publishBestEffort(
        input.publish,
        { type: "shared_with_you", userId: recipientUserId },
        "container mutation notification",
      );
    }
  }
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
        return respondToStatusError(c, error, DeleteContainerError);
      }
    },
  );

  return route;
}
