import type {
  ContainerMutationRequest,
  DocumentLinkSetMutationRequest,
} from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import type { PublishedRealtimeEvent } from "../../realtime/publishedRealtimeEvents";
import { uniqueSortedStrings } from "../../utils/array";
import { publishBestEffort } from "../../utils/publishBestEffort";
import { publishContainerMutationCreated } from "../containers/mutationEvents";

type DocumentLinkSetEventType = "document.link" | "document.unlink";
type DocumentMutationOrigin = {
  readonly sessionId: string;
  readonly userId: string;
};
type Publish = (event: PublishedRealtimeEvent) => Promise<void>;

function toMutableContainerPaths(
  containerPaths: Readonly<Record<string, readonly string[]>> | undefined,
): Record<string, string[]> | undefined {
  if (!containerPaths) return undefined;
  return Object.fromEntries(
    Object.entries(containerPaths).map(([id, path]) => [id, [...path]]),
  );
}

export function createDocumentMutationCreatedEvent(input: {
  readonly containerPaths?:
    | Readonly<Record<string, readonly string[]>>
    | undefined;
  readonly documentId: string;
  readonly eventType: DocumentLinkSetEventType;
  /** The document's KEK target containers after the mutation. */
  readonly linkedContainerIds: readonly string[];
  readonly origin: DocumentMutationOrigin;
  readonly request: DocumentLinkSetMutationRequest;
}): PublishedRealtimeEvent {
  const mutationTargetContainerId =
    input.request.targetContainerPathRefs.at(-1)?.containerId;
  const containerIds = [
    ...input.linkedContainerIds,
    ...(mutationTargetContainerId ? [mutationTargetContainerId] : []),
  ];
  const containerPaths = toMutableContainerPaths(input.containerPaths);
  return {
    type: "document_mutation_created",
    containerIds: uniqueSortedStrings(containerIds),
    ...(containerPaths === undefined ? {} : { containerPaths }),
    documentId: input.documentId,
    eventType: input.eventType,
    origin: input.origin,
  };
}

export async function publishDocumentMutationCreatedEvent(input: {
  readonly containerPaths?:
    | Readonly<Record<string, readonly string[]>>
    | undefined;
  readonly documentId: string;
  readonly eventType: DocumentLinkSetEventType;
  readonly linkedContainerIds: readonly string[];
  readonly origin: DocumentMutationOrigin;
  readonly publish: Publish;
  readonly request: DocumentLinkSetMutationRequest;
}): Promise<void> {
  await publishBestEffort(
    input.publish,
    createDocumentMutationCreatedEvent(input),
    "document mutation event",
  );
}

export function createDocumentUpdateCreatedEvent(input: {
  readonly containerIds: readonly string[];
  readonly containerPaths?:
    | Readonly<Record<string, readonly string[]>>
    | undefined;
  readonly documentId: string;
  readonly origin: DocumentMutationOrigin;
  readonly updateIds: readonly string[];
}): PublishedRealtimeEvent {
  const containerPaths = toMutableContainerPaths(input.containerPaths);
  return {
    type: "document_update_created",
    containerIds: [...input.containerIds],
    ...(containerPaths === undefined ? {} : { containerPaths }),
    documentId: input.documentId,
    updateIds: [...input.updateIds],
    origin: input.origin,
  };
}

export async function publishDocumentUpdateCreatedEvent(input: {
  readonly containerIds: readonly string[];
  readonly containerPaths?:
    | Readonly<Record<string, readonly string[]>>
    | undefined;
  readonly documentId: string;
  readonly origin: DocumentMutationOrigin;
  readonly publish: Publish;
  readonly updateIds: readonly string[];
}): Promise<void> {
  await publishBestEffort(
    input.publish,
    createDocumentUpdateCreatedEvent(input),
    "document update event",
  );
}

export async function publishDocumentSyncContainerRekeyEvents(input: {
  readonly containerRekeys: readonly {
    readonly ancestorIds?: readonly string[] | undefined;
    readonly request: ContainerMutationRequest;
    readonly response: ContainerMutationResponse;
  }[];
  readonly origin: DocumentMutationOrigin;
  readonly publish: Publish;
}): Promise<void> {
  for (const { ancestorIds, request, response } of input.containerRekeys) {
    await publishContainerMutationCreated({
      ancestorIds,
      expectedEventType: "container.rekey",
      origin: input.origin,
      publish: input.publish,
      request,
      response,
    });
  }
}

export function createDocumentPurgeEvent(input: {
  readonly containerIds: readonly string[];
  readonly containerPaths?:
    | Readonly<Record<string, readonly string[]>>
    | undefined;
  readonly documentId: string;
  readonly origin: DocumentMutationOrigin;
}): PublishedRealtimeEvent {
  const containerPaths = toMutableContainerPaths(input.containerPaths);
  return {
    type: "document_mutation_created",
    containerIds: uniqueSortedStrings(input.containerIds),
    ...(containerPaths === undefined ? {} : { containerPaths }),
    documentId: input.documentId,
    eventType: "document.purge",
    origin: input.origin,
  };
}

export async function publishDocumentPurgeEvent(input: {
  readonly containerIds: readonly string[];
  readonly containerPaths?:
    | Readonly<Record<string, readonly string[]>>
    | undefined;
  readonly documentId: string;
  readonly origin: DocumentMutationOrigin;
  readonly publish: Publish;
}): Promise<void> {
  await publishBestEffort(
    input.publish,
    createDocumentPurgeEvent(input),
    "document purge event",
  );
}
