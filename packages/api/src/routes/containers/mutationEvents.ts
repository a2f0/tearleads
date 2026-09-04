import type { AccessEventType } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { isAccessEventType } from "../../keyingProjectionRecords";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import { publishBestEffort } from "../../utils/publishBestEffort";

type MutationEventRequest = Pick<
  ContainerMutationRequest,
  "body" | "previousManifest"
>;

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readContainerMutationBodyEventType(
  request: MutationEventRequest,
): AccessEventType | null {
  if (!isPlainObject(request.body)) return null;
  const eventType = Reflect.get(request.body, "eventType");
  return isAccessEventType(eventType) ? eventType : null;
}

function readContainerMutationPreviousParentId(
  request: MutationEventRequest,
): string | null | undefined {
  const previousState = request.previousManifest?.state;
  return previousState
    ? readNullableString(Reflect.get(previousState, "parentContainerId"))
    : undefined;
}

// A direct user recipient has not declared interest in this container yet, so
// the scoped access event cannot reach them. A user-scoped hint fills that gap.
function readGrantUserRecipientId(
  request: MutationEventRequest,
): string | null {
  if (!isPlainObject(request.body)) return null;
  const grant = Reflect.get(request.body, "grant");
  if (!isPlainObject(grant)) return null;
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
  readonly publish: (event: PublishedRealtimeEvent) => Promise<void>;
  readonly request: MutationEventRequest;
  readonly response: Pick<
    ContainerMutationResponse,
    "containerId" | "parentId" | "updatedAt"
  >;
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
      origin: input.origin,
      parentId: input.response.parentId,
      ...(previousParentId === undefined ? {} : { previousParentId }),
      updatedAt: input.response.updatedAt,
    },
    "container mutation notification",
  );

  if (eventType !== "container.create") {
    await publishBestEffort(
      input.publish,
      { type: "access_changed", containerId: input.response.containerId },
      "container mutation notification",
    );
  }

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
