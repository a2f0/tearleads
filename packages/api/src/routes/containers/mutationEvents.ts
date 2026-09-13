import type { AccessEventType } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { reportBackgroundFailure } from "../../diagnostics/reportBackgroundFailure";
import { isAccessEventType } from "../../keyingProjectionRecords";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import { publishBestEffort } from "../../utils/publishBestEffort";

type MutationEventRequest = Pick<
  ContainerMutationRequest,
  "body" | "previousManifest"
>;

interface GrantSubject {
  readonly subjectId: string;
  readonly subjectType: string;
}

interface PublishContainerMutationCreatedInput {
  readonly expectedEventType: AccessEventType;
  readonly origin: { readonly sessionId: string; readonly userId: string };
  readonly publish: (event: PublishedRealtimeEvent) => Promise<void>;
  readonly request: MutationEventRequest;
  // Current direct members of a granted group; absent where no grant can occur.
  readonly resolveGroupMemberUserIds?: (
    groupId: string,
  ) => Promise<readonly string[]>;
  readonly response: Pick<
    ContainerMutationResponse,
    "containerId" | "parentId" | "updatedAt"
  >;
}

// Only mutations that can remove read access evict subscribers. A grant adds a
// reader, a rekey rotates key material, and a recite refreshes ancestor
// citations — none changes membership, so evicting on them would resync every
// descendant subscriber of a hot root for nothing.
const EVICTING_EVENT_TYPES: ReadonlySet<AccessEventType> =
  new Set<AccessEventType>(["container.move", "container.revoke"]);

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

function readGrantSubject(request: MutationEventRequest): GrantSubject | null {
  if (!isPlainObject(request.body)) return null;
  const grant = Reflect.get(request.body, "grant");
  if (!isPlainObject(grant)) return null;
  const subjectType = Reflect.get(grant, "subjectType");
  const subjectId = Reflect.get(grant, "subjectId");
  return typeof subjectType === "string" &&
    typeof subjectId === "string" &&
    subjectId.length > 0
    ? { subjectId, subjectType }
    : null;
}

// A grant recipient has not declared interest in this container yet, so the
// scoped hint cannot reach them. A user-scoped `shared_with_you` fills that gap
// for a direct user grant and for every current member of a granted group.
// Membership resolution runs after the commit; a failure there must not turn
// the committed grant into an error, so it degrades to no notification.
async function grantRecipientUserIds(
  input: PublishContainerMutationCreatedInput,
): Promise<readonly string[]> {
  const subject = readGrantSubject(input.request);
  if (!subject) return [];
  if (subject.subjectType === "user") return [subject.subjectId];
  if (subject.subjectType !== "group" || !input.resolveGroupMemberUserIds)
    return [];
  try {
    return await input.resolveGroupMemberUserIds(subject.subjectId);
  } catch (error) {
    console.error("Failed to resolve group grant recipients:", error);
    reportBackgroundFailure(error);
    return [];
  }
}

export async function publishContainerMutationCreated(
  input: PublishContainerMutationCreatedInput,
) {
  const previousParentId = readContainerMutationPreviousParentId(input.request);
  const eventType =
    readContainerMutationBodyEventType(input.request) ??
    input.expectedEventType;

  // Eviction precedes the hint: a socket that just lost access must not be
  // handed the revoke or move hint describing what it can no longer read.
  if (EVICTING_EVENT_TYPES.has(eventType)) {
    await publishBestEffort(
      input.publish,
      { type: "access_changed", containerId: input.response.containerId },
      "container mutation notification",
    );
  }

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

  if (eventType === "container.grant") {
    for (const userId of await grantRecipientUserIds(input)) {
      await publishBestEffort(
        input.publish,
        { type: "shared_with_you", userId },
        "container mutation notification",
      );
    }
  }
}
