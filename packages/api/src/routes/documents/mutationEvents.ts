import type {
  ContainerMutationRequest,
  DocumentLinkSetMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  DocumentLinkSetMutationResponse,
  DocumentSyncResponse,
} from "@tearleads/validators/response";
import { uniqueSortedStrings } from "../../utils/array";
import { publishBestEffort } from "../../utils/publishBestEffort";
import { publishContainerMutationCreated } from "../containers/mutationEvents";

type DocumentLinkSetEventType = "document.link" | "document.unlink";
type DocumentMutationOrigin = {
  readonly sessionId: string;
  readonly userId: string;
};
type Publish = (event: Record<string, unknown>) => Promise<void>;

function listDocumentKekTargetContainerIds(
  documentKekTargets: DocumentSyncResponse["documentKekTargets"],
): string[] {
  return documentKekTargets.targets.flatMap((target) => {
    if (typeof target !== "object" || target === null) return [];
    const containerId = Reflect.get(target, "containerId");
    return typeof containerId === "string" ? [containerId] : [];
  });
}

export function createDocumentMutationCreatedEvent(input: {
  readonly documentId: string;
  readonly eventType: DocumentLinkSetEventType;
  readonly origin: DocumentMutationOrigin;
  readonly request: DocumentLinkSetMutationRequest;
  readonly response: DocumentLinkSetMutationResponse;
}): Record<string, unknown> {
  const mutationTargetContainerId =
    input.request.targetContainerPathRefs.at(-1)?.containerId;
  const containerIds = [
    ...listDocumentKekTargetContainerIds(input.response.documentKekTargets),
    ...(mutationTargetContainerId ? [mutationTargetContainerId] : []),
  ];
  return {
    type: "document_mutation_created",
    containerIds: uniqueSortedStrings(containerIds),
    documentId: input.documentId,
    eventType: input.eventType,
    origin: input.origin,
  };
}

export async function publishDocumentMutationCreatedEvent(input: {
  readonly documentId: string;
  readonly eventType: DocumentLinkSetEventType;
  readonly origin: DocumentMutationOrigin;
  readonly publish: Publish;
  readonly request: DocumentLinkSetMutationRequest;
  readonly response: DocumentLinkSetMutationResponse;
}): Promise<void> {
  await publishBestEffort(
    input.publish,
    createDocumentMutationCreatedEvent(input),
    "document mutation event",
  );
}

export function createDocumentUpdateCreatedEvent(input: {
  readonly documentId: string;
  readonly documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  readonly origin: DocumentMutationOrigin;
  readonly updateIds: readonly string[];
}): Record<string, unknown> {
  return {
    type: "document_update_created",
    containerIds: listDocumentKekTargetContainerIds(input.documentKekTargets),
    documentId: input.documentId,
    updateIds: [...input.updateIds],
    origin: input.origin,
  };
}

export async function publishDocumentUpdateCreatedEvent(input: {
  readonly documentId: string;
  readonly documentKekTargets: DocumentSyncResponse["documentKekTargets"];
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
    readonly request: ContainerMutationRequest;
    readonly response: ContainerMutationResponse;
  }[];
  readonly origin: DocumentMutationOrigin;
  readonly publish: Publish;
}): Promise<void> {
  for (const { request, response } of input.containerRekeys) {
    await publishContainerMutationCreated({
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
  readonly documentId: string;
  readonly origin: DocumentMutationOrigin;
}): Record<string, unknown> {
  return {
    type: "document_mutation_created",
    containerIds: uniqueSortedStrings(input.containerIds),
    documentId: input.documentId,
    eventType: "document.purge",
    origin: input.origin,
  };
}

export async function publishDocumentPurgeEvent(input: {
  readonly containerIds: readonly string[];
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
