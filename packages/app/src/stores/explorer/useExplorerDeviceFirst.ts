import type {
  ContainerContentsWorkflowRuntime,
  ContainerNode,
  DocumentSummary,
  LocalProjectionView,
  ReconciliationService,
} from "@tearleads/client-sdk";
import { enqueueReconciliationForEvents } from "@tearleads/client-sdk";
import { useEffect, useMemo, useRef } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";

function isDocumentUpdateEvent(event: unknown): event is {
  readonly containerIds?: unknown;
  readonly documentId?: unknown;
  readonly id?: unknown;
  readonly type: "document_update_created";
} {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "document_update_created"
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

export function takePendingExplorerReconciliationEvents(input: {
  events: ReadonlyArray<unknown>;
  documentSummariesByContainerId?: ReadonlyMap<
    string,
    ReadonlyArray<DocumentSummary>
  >;
  knownContainerIds: ReadonlyArray<string>;
  processedEventKeys: Set<string>;
}): ReadonlyArray<unknown> {
  const knownContainerIds = new Set(input.knownContainerIds);
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
    if (!isDocumentUpdateEvent(event)) {
      return;
    }

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
        event.containerIds.filter(
          (containerId): containerId is string =>
            typeof containerId === "string" &&
            knownContainerIds.has(containerId) &&
            !(
              typeof event.documentId === "string" &&
              getDocumentIdSet(containerId).has(event.documentId)
            ) &&
            !input.processedEventKeys.has(`${eventKey}:${containerId}`),
        ),
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
 * Wire the explorer to the device-first SDK seam: the local projection view
 * (instant reads) and the background reconciler. Server events are routed into
 * the reconciler here so the provider never drives network from a render effect.
 */
export function useExplorerDeviceFirst(input: {
  runtime: ContainerContentsWorkflowRuntime;
  events: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<ContainerNode>;
}): { reconciler: ReconciliationService; view: LocalProjectionView } {
  const tearleads = useTearleads();
  const { events, nodes, runtime } = input;
  const domainScope = runtime.state.domainScope;
  const processedEventKeysRef = useRef<Set<string>>(new Set());
  const processedEventScopeRef = useRef(domainScope);
  if (processedEventScopeRef.current !== domainScope) {
    processedEventScopeRef.current = domainScope;
    processedEventKeysRef.current = new Set();
  }
  const view = useMemo(
    () => tearleads.deviceFirst.openView({ logLabel: "Explorer" }),
    [domainScope, tearleads],
  );
  const reconciler = useMemo(
    () => tearleads.deviceFirst.reconciler(),
    [domainScope, tearleads],
  );
  const knownContainerIds = useMemo(
    () => nodes.flatMap((node) => (node.systemSlot ? [] : [node.id])),
    [nodes],
  );

  // Drive runtime updates from an effect — never during render — so the view's
  // synchronous emit cannot setState in a child while the provider renders.
  useEffect(() => {
    view.updateRuntime(runtime);
  }, [runtime, view]);

  useEffect(() => {
    if (events.length === 0) {
      return;
    }
    const pendingEvents = takePendingExplorerReconciliationEvents({
      documentSummariesByContainerId:
        view.getSnapshot().documentSummariesByContainerId,
      events,
      knownContainerIds,
      processedEventKeys: processedEventKeysRef.current,
    });
    if (pendingEvents.length === 0) {
      return;
    }
    enqueueReconciliationForEvents({
      events: pendingEvents,
      knownContainerIds,
      service: reconciler,
    });
  }, [events, knownContainerIds, reconciler]);

  return { reconciler, view };
}
