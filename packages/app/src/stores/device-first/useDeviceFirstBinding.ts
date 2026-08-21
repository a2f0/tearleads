import type {
  ContainerContentsStoreRuntime,
  ContainerNode,
  DeviceFirstContainerContents,
  DocumentSummary,
} from "@symcrypt/client-sdk";
import { enqueueReconciliationForEvents } from "@symcrypt/client-sdk";
import { useEffect, useMemo, useRef } from "react";
import { useSymCrypt } from "../../providers/sdk/SymCryptProvider";
import { useSymCryptExternalStoreSnapshot } from "../../providers/sdk/useSymCryptSubscription";

interface DocumentReconciliationEvent {
  readonly containerIds?: unknown;
  readonly documentId?: unknown;
  readonly eventType?: unknown;
  readonly id?: unknown;
  readonly type: "document_mutation_created" | "document_update_created";
}

function isDocumentMutationEvent(
  event: unknown,
): event is DocumentReconciliationEvent & {
  readonly containerIds: string[];
  readonly documentId: string;
  readonly eventType: "document.link" | "document.purge" | "document.unlink";
  readonly type: "document_mutation_created";
} {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "document_mutation_created" &&
    "documentId" in event &&
    typeof event.documentId === "string" &&
    event.documentId.length > 0 &&
    "eventType" in event &&
    (event.eventType === "document.link" ||
      event.eventType === "document.purge" ||
      event.eventType === "document.unlink") &&
    "containerIds" in event &&
    Array.isArray(event.containerIds) &&
    event.containerIds.length > 0 &&
    event.containerIds.every(
      (containerId) =>
        typeof containerId === "string" && containerId.length > 0,
    )
  );
}

function isDocumentReconciliationEvent(
  event: unknown,
): event is DocumentReconciliationEvent {
  return (
    isDocumentMutationEvent(event) ||
    (typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "document_update_created")
  );
}

function reconciliationEventKey(event: unknown, index: number): string {
  if (
    typeof event === "object" &&
    event !== null &&
    "id" in event &&
    typeof event.id === "string"
  ) {
    return event.id;
  }

  return `event-index:${index}`;
}

function isForeignSystemContainerNode(
  node: Pick<
    ContainerNode,
    "effectiveAccessLevel" | "organizationId" | "systemSlot"
  >,
  homeOrganizationId: string | null,
): boolean {
  return (
    !!node.systemSlot &&
    homeOrganizationId !== null &&
    !!node.organizationId &&
    node.organizationId !== homeOrganizationId &&
    (node.effectiveAccessLevel === "read" ||
      node.effectiveAccessLevel === "admin")
  );
}

function isRemoteBackedOwnSystemContainerNode(
  node: Pick<
    ContainerNode,
    "metadataDocumentId" | "organizationId" | "systemSlot"
  >,
  homeOrganizationId: string | null,
): boolean {
  return (
    !!node.systemSlot &&
    homeOrganizationId !== null &&
    node.organizationId === homeOrganizationId &&
    typeof node.metadataDocumentId === "string" &&
    node.metadataDocumentId.length > 0
  );
}

type ReconciliationContainerRouting = {
  forceKnownDocumentContainerIds: ReadonlySet<string>;
  knownContainerIds: ReadonlyArray<string>;
};

type ReconciliationContainerRoutingEntry = readonly [
  containerId: string,
  forceKnownDocumentContainer: boolean,
];

const ROUTING_FORCE_PREFIX = "1:";
const ROUTING_NORMAL_PREFIX = "0:";

function collectReconciliationContainerRoutingEntries(input: {
  containers: ReadonlyArray<ContainerNode>;
  homeOrganizationId: string | null;
}): ReconciliationContainerRoutingEntry[] {
  const entries: ReconciliationContainerRoutingEntry[] = [];

  for (const node of input.containers) {
    const isForeignSystemContainer = isForeignSystemContainerNode(
      node,
      input.homeOrganizationId,
    );
    const isRemoteBackedOwnSystemContainer =
      isRemoteBackedOwnSystemContainerNode(node, input.homeOrganizationId);
    if (
      node.systemSlot &&
      !isForeignSystemContainer &&
      !isRemoteBackedOwnSystemContainer
    ) {
      continue;
    }

    entries.push([node.id, isForeignSystemContainer]);
  }

  return entries;
}

export function buildReconciliationContainerRoutingKey(input: {
  containers: ReadonlyArray<ContainerNode>;
  homeOrganizationId: string | null;
}): string {
  return collectReconciliationContainerRoutingEntries(input)
    .map(
      ([containerId, forceKnownDocumentContainer]) =>
        `${forceKnownDocumentContainer ? ROUTING_FORCE_PREFIX : ROUTING_NORMAL_PREFIX}${containerId}`,
    )
    .join("\n");
}

function buildReconciliationContainerRoutingFromEntries(
  entries: ReadonlyArray<ReconciliationContainerRoutingEntry>,
): ReconciliationContainerRouting {
  const forceKnownDocumentContainerIds = new Set<string>();
  const knownContainerIds: string[] = [];

  for (const [containerId, forceKnownDocumentContainer] of entries) {
    knownContainerIds.push(containerId);
    if (forceKnownDocumentContainer) {
      forceKnownDocumentContainerIds.add(containerId);
    }
  }

  return { forceKnownDocumentContainerIds, knownContainerIds };
}

export function buildReconciliationContainerRouting(input: {
  containers: ReadonlyArray<ContainerNode>;
  homeOrganizationId: string | null;
}): ReconciliationContainerRouting {
  return buildReconciliationContainerRoutingFromEntries(
    collectReconciliationContainerRoutingEntries(input),
  );
}

function buildReconciliationContainerRoutingFromKey(
  key: string,
): ReconciliationContainerRouting {
  if (key === "") {
    return {
      forceKnownDocumentContainerIds: new Set(),
      knownContainerIds: [],
    };
  }

  const entries: ReconciliationContainerRoutingEntry[] = key
    .split("\n")
    .map(
      (entry): ReconciliationContainerRoutingEntry => [
        entry.slice(ROUTING_FORCE_PREFIX.length),
        entry.startsWith(ROUTING_FORCE_PREFIX),
      ],
    );
  return buildReconciliationContainerRoutingFromEntries(entries);
}

/**
 * Dedupe a batch of server events down to the ones a mini-app has not yet
 * routed into the reconciler. Content events are skipped when their document
 * is already present in that container's cached summaries. Structural mutation
 * events always pass that check because an existing document may have just
 * entered or left the container.
 *
 * `linkedContainerIdsByDocumentId` is the local projection's reverse index of
 * which containers each remote document is already linked to. It suppresses
 * self-echoes: when this client uploads a document, the server echoes a
 * `document_update_created` carrying the remote documentId, but the per-container
 * summary's `documentId` lags behind (it only populates after the document
 * syncs), so the summary check alone misses it and the reconciliation lane
 * needlessly re-discovers the container once per uploaded file. The check is
 * per-container — it only skips a container the document is ALREADY linked to —
 * so a genuine new link of a known document into a different container is still
 * reconciled.
 */
export function takePendingReconciliationEvents(input: {
  events: ReadonlyArray<unknown>;
  documentSummariesByContainerId?: ReadonlyMap<
    string,
    ReadonlyArray<DocumentSummary>
  >;
  forceKnownDocumentContainerIds?: ReadonlySet<string> | undefined;
  knownContainerIds: ReadonlyArray<string>;
  linkedContainerIdsByDocumentId?: ReadonlyMap<string, ReadonlyArray<string>>;
  processedEventKeys: Set<string>;
}): ReadonlyArray<unknown> {
  const knownContainerIds = new Set(input.knownContainerIds);
  const isDocumentLinkedToContainer = (
    documentId: string,
    containerId: string,
  ): boolean =>
    input.linkedContainerIdsByDocumentId
      ?.get(documentId)
      ?.includes(containerId) ?? false;
  const documentIdSetsByContainerId = new Map<string, ReadonlySet<string>>();
  const getDocumentIdSet = (containerId: string): ReadonlySet<string> => {
    const cached = documentIdSetsByContainerId.get(containerId);
    if (cached) {
      return cached;
    }
    const documentIds = new Set(
      (input.documentSummariesByContainerId?.get(containerId) ?? []).flatMap(
        (summary) => (summary.documentId ? [summary.documentId] : []),
      ),
    );
    documentIdSetsByContainerId.set(containerId, documentIds);
    return documentIds;
  };
  const pendingEvents: unknown[] = [];

  input.events.forEach((event, index) => {
    if (!isDocumentReconciliationEvent(event)) {
      return;
    }

    const isMutationEvent = isDocumentMutationEvent(event);
    const eventKey = reconciliationEventKey(event, index);
    if (event.containerIds === undefined) {
      const unscopedKey = `${eventKey}:*`;
      if (!input.processedEventKeys.has(unscopedKey)) {
        input.processedEventKeys.add(unscopedKey);
        pendingEvents.push(event);
      }
      return;
    }

    if (!Array.isArray(event.containerIds)) {
      return;
    }

    const pendingContainerIds = Array.from(
      new Set(
        event.containerIds.filter((containerId): containerId is string => {
          if (
            typeof containerId !== "string" ||
            !knownContainerIds.has(containerId)
          ) {
            return false;
          }
          if (input.processedEventKeys.has(`${eventKey}:${containerId}`)) {
            return false;
          }
          if (
            isMutationEvent ||
            input.forceKnownDocumentContainerIds?.has(containerId) === true
          ) {
            return true;
          }
          return !(
            typeof event.documentId === "string" &&
            // Already present in this container's summaries, or — covering the
            // self-echo window where the summary's documentId still lags —
            // already linked to this container in the reverse index.
            (getDocumentIdSet(containerId).has(event.documentId) ||
              isDocumentLinkedToContainer(event.documentId, containerId))
          );
        }),
      ),
    );
    if (pendingContainerIds.length === 0) {
      return;
    }

    for (const containerId of pendingContainerIds) {
      input.processedEventKeys.add(`${eventKey}:${containerId}`);
    }
    pendingEvents.push({ ...event, containerIds: pendingContainerIds });
  });

  return pendingEvents;
}

/**
 * Bind React to the SDK's complete device-first seam: locally durable container
 * writes, the synchronous local projection, and background reconciliation.
 * Server events are routed here so render effects never own network work. All
 * three handles are cached and shared per domain scope.
 */
export function useDeviceFirstBinding(input: {
  runtime: ContainerContentsStoreRuntime;
  events: ReadonlyArray<unknown>;
  logLabel: string;
}): DeviceFirstContainerContents {
  const symcrypt = useSymCrypt();
  const { events, logLabel, runtime } = input;
  const domainScope = runtime.state.domainScope;
  const processedEventKeysRef = useRef<Set<string>>(new Set());
  const processedEventScopeRef = useRef(domainScope);
  if (processedEventScopeRef.current !== domainScope) {
    processedEventScopeRef.current = domainScope;
    processedEventKeysRef.current = new Set();
  }
  const deviceFirst = useMemo(
    () => symcrypt.deviceFirst.open({ logLabel }),
    [domainScope, logLabel, symcrypt],
  );
  const { reconciler, view } = deviceFirst;
  const viewSnapshot = useSymCryptExternalStoreSnapshot(view);
  // Stabilise routing by content: container snapshots can churn for sync-state
  // changes, but event routing only needs to re-run when the routed ids or their
  // forced-content flag change. Remote-backed own system containers participate
  // normally so another session's Contacts/Trash mutations reconcile here;
  // local-only system containers have no remote lane to pull yet.
  const reconciliationRoutingKey = buildReconciliationContainerRoutingKey({
    containers: viewSnapshot.containers,
    homeOrganizationId: runtime.auth.organizationId,
  });
  const reconciliationRouting = useMemo(
    () => buildReconciliationContainerRoutingFromKey(reconciliationRoutingKey),
    [reconciliationRoutingKey],
  );

  // Drive runtime updates from an effect — never during render — so the view's
  // synchronous emit cannot setState in a child while the provider renders.
  useEffect(() => {
    if (runtime.infra.dbStatus === "ready" && !runtime.state.containerId) {
      return;
    }

    view.updateRuntime(runtime);
  }, [runtime, view]);

  useEffect(() => {
    if (events.length === 0) {
      return;
    }
    const viewSnapshot = view.getSnapshot();
    const pendingEvents = takePendingReconciliationEvents({
      documentSummariesByContainerId:
        viewSnapshot.documentSummariesByContainerId,
      events,
      forceKnownDocumentContainerIds:
        reconciliationRouting.forceKnownDocumentContainerIds,
      knownContainerIds: reconciliationRouting.knownContainerIds,
      linkedContainerIdsByDocumentId:
        viewSnapshot.linkedContainerIdsByDocumentId,
      processedEventKeys: processedEventKeysRef.current,
    });
    if (pendingEvents.length === 0) {
      return;
    }
    enqueueReconciliationForEvents({
      domainScope,
      events: pendingEvents,
      knownContainerIds: reconciliationRouting.knownContainerIds,
      service: reconciler,
    });
  }, [domainScope, events, reconciler, reconciliationRouting, view]);

  return deviceFirst;
}
