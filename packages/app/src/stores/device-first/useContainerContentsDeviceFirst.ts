import type {
  ContainerContentsWorkflowRuntime,
  DocumentSummary,
  LocalProjectionView,
  ReconciliationService,
} from "@tearleads/client-sdk";
import { enqueueReconciliationForEvents } from "@tearleads/client-sdk";
import { useEffect, useMemo, useRef } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";

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

/**
 * Dedupe a batch of server events down to the ones a mini-app has not yet
 * routed into the reconciler. Events are matched per known container, and
 * skipped when their document is already present in that container's cached
 * summaries, so reopening or re-rendering never re-enqueues the same work.
 */
export function takePendingReconciliationEvents(input: {
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
 * Wire a mini-app to the device-first SDK seam: the local projection view
 * (instant local reads) and the background reconciler. Server events are routed
 * into the reconciler here so the provider never drives network from a render
 * effect. The view + reconciler are cached per domain scope, so every mini-app
 * in the same scope shares one read view and one reconciler.
 */
export function useContainerContentsDeviceFirst(input: {
  runtime: ContainerContentsWorkflowRuntime;
  events: ReadonlyArray<unknown>;
  logLabel: string;
}): { reconciler: ReconciliationService; view: LocalProjectionView } {
  const tearleads = useTearleads();
  const { events, logLabel, runtime } = input;
  const domainScope = runtime.state.domainScope;
  const processedEventKeysRef = useRef<Set<string>>(new Set());
  const processedEventScopeRef = useRef(domainScope);
  if (processedEventScopeRef.current !== domainScope) {
    processedEventScopeRef.current = domainScope;
    processedEventKeysRef.current = new Set();
  }
  const view = useMemo(
    () => tearleads.deviceFirst.openView({ logLabel }),
    [domainScope, logLabel, tearleads],
  );
  const reconciler = useMemo(
    () => tearleads.deviceFirst.reconciler(),
    [domainScope, tearleads],
  );
  const viewSnapshot = useTearleadsExternalStoreSnapshot(view);
  // Stabilise the id list by content: the view emits a fresh `containers` array
  // on every tree change (including node syncState churn during sync), but the
  // event-routing effect below only needs to re-run when the *set* of
  // reconcilable (non-system) container ids actually changes.
  const knownContainerIdsKey = viewSnapshot.containers
    .flatMap((node) => (node.systemSlot ? [] : [node.id]))
    .join("\n");
  const knownContainerIds = useMemo(
    () => (knownContainerIdsKey === "" ? [] : knownContainerIdsKey.split("\n")),
    [knownContainerIdsKey],
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
    const pendingEvents = takePendingReconciliationEvents({
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
