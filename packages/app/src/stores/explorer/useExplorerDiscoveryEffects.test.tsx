import { afterEach, expect, test } from "bun:test";
import type { ContainerContents, DocumentSummary } from "@tearleads/client-sdk";
import { createDomainScope } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { useDiscoveredDocumentsSync } from "./useDiscoveredDocumentsSync";
import { useExplorerRefreshAction } from "./useExplorerRefreshAction";

type UseDiscoveredDocumentsSyncParams = Parameters<
  typeof useDiscoveredDocumentsSync
>[0];
interface ListContainerDocumentsResponse {
  hasMore: boolean;
  items: [];
  nextWatermark: null;
  tombstones: [];
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function createEmptyListContainerDocumentsResponse(): ListContainerDocumentsResponse {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  };
}

function createDocumentSummary(id: string): DocumentSummary {
  return {
    containerId: "container-1",
    documentId: `${id}-remote`,
    id,
    title: "Discovered document",
    updatedAt: "2026-05-24T00:00:00.000Z",
  };
}

function createReadyExplorerDiscoveryAppData(): UseDiscoveredDocumentsSyncParams["appData"] {
  return {
    auth: {
      isAuthenticated: true,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {},
      dbStatus: "ready",
      execSql: async () => {
        throw new Error("execSql should not be used by this test.");
      },
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => undefined,
      log: () => undefined,
      logError: () => undefined,
    },
  } as unknown as UseDiscoveredDocumentsSyncParams["appData"];
}

afterEach(() => {
  cleanup();
});

test("container document discovery reuses an in-flight run for repeated effect triggers", async () => {
  const listedDocuments = createDeferred<ListContainerDocumentsResponse>();
  const applyOrder: string[] = [];
  let listContainerDocumentsCallCount = 0;
  let documentLinksChangedCallCount = 0;
  const baseAppData = {
    auth: {
      isAuthenticated: true,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {},
      dbStatus: "ready",
      execSql: async () => {
        throw new Error("execSql should not be used by this test.");
      },
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => undefined,
      log: () => undefined,
      logError: () => undefined,
    },
  } as unknown as UseDiscoveredDocumentsSyncParams["appData"];
  const mergeDocumentSummaries = (
    _nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => {
    applyOrder.push("merge");
  };
  const discoverDocuments: ContainerContents["discoverDocuments"] =
    async () => {
      listContainerDocumentsCallCount += 1;
      await listedDocuments.promise;
      return [createDocumentSummary("document-1")];
    };
  const remoteUpdateEvents = [
    {
      documentId: "remote-doc-1",
      id: "event-1",
      type: "document_update_created",
    },
  ] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"];

  const view = renderHook(
    ({
      events,
    }: {
      events: UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"];
    }) =>
      useDiscoveredDocumentsSync({
        activeContainerId: "container-1",
        appData: {
          ...baseAppData,
          state: { ...baseAppData.state, events },
        },
        discoverDocuments,
        hasUndiscoveredDocumentUpdates: () => events.length > 0,
        knownDocumentIds: new Set(),
        mergeDocumentSummaries,
        onDocumentLinksChanged: () => {
          documentLinksChangedCallCount += 1;
          applyOrder.push("links");
        },
        primeDiscoveredDocuments: () => {
          applyOrder.push("prime");
        },
      }),
    {
      initialProps: {
        events:
          [] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"],
      },
      wrapper: StrictMode,
    },
  );

  await waitFor(() => {
    expect(listContainerDocumentsCallCount).toBe(1);
  });

  view.rerender({ events: remoteUpdateEvents });
  expect(listContainerDocumentsCallCount).toBe(1);

  listedDocuments.resolve(createEmptyListContainerDocumentsResponse());

  await waitFor(() => {
    expect(documentLinksChangedCallCount).toBe(1);
  });
  expect(applyOrder).toEqual(["merge", "links", "prime"]);
});

test("container document discovery starts a new run when discovery dependencies change", async () => {
  const firstListedDocuments = createDeferred<ListContainerDocumentsResponse>();
  const secondListedDocuments =
    createDeferred<ListContainerDocumentsResponse>();
  let firstListContainerDocumentsCallCount = 0;
  let secondListContainerDocumentsCallCount = 0;
  let documentLinksChangedCallCount = 0;
  const baseAppData = {
    auth: {
      isAuthenticated: true,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {},
      dbStatus: "ready",
      execSql: async () => {
        throw new Error("execSql should not be used by this test.");
      },
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => undefined,
      log: () => undefined,
      logError: () => undefined,
    },
  } as unknown as UseDiscoveredDocumentsSyncParams["appData"];
  const mergeDocumentSummaries = (
    _nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => undefined;
  const createDiscoverDocuments =
    (
      listContainerDocuments: () => Promise<ListContainerDocumentsResponse>,
    ): ContainerContents["discoverDocuments"] =>
    async () => {
      await listContainerDocuments();
      return [createDocumentSummary("document-1")];
    };

  const view = renderHook(
    ({
      appData,
      discoverDocuments,
    }: {
      appData: UseDiscoveredDocumentsSyncParams["appData"];
      discoverDocuments: ContainerContents["discoverDocuments"];
    }) =>
      useDiscoveredDocumentsSync({
        activeContainerId: "container-1",
        appData,
        discoverDocuments,
        hasUndiscoveredDocumentUpdates: () => false,
        knownDocumentIds: new Set(),
        mergeDocumentSummaries,
        onDocumentLinksChanged: () => {
          documentLinksChangedCallCount += 1;
        },
        primeDiscoveredDocuments: () => undefined,
      }),
    {
      initialProps: {
        appData: {
          ...baseAppData,
        } as UseDiscoveredDocumentsSyncParams["appData"],
        discoverDocuments: createDiscoverDocuments(() => {
          firstListContainerDocumentsCallCount += 1;
          return firstListedDocuments.promise;
        }),
      },
      wrapper: StrictMode,
    },
  );

  await waitFor(() => {
    expect(firstListContainerDocumentsCallCount).toBe(1);
  });

  view.rerender({
    appData: {
      ...baseAppData,
    } as UseDiscoveredDocumentsSyncParams["appData"],
    discoverDocuments: createDiscoverDocuments(() => {
      secondListContainerDocumentsCallCount += 1;
      return secondListedDocuments.promise;
    }),
  });

  await waitFor(() => {
    expect(secondListContainerDocumentsCallCount).toBe(1);
  });
  expect(firstListContainerDocumentsCallCount).toBe(1);

  firstListedDocuments.resolve(createEmptyListContainerDocumentsResponse());
  secondListedDocuments.resolve(createEmptyListContainerDocumentsResponse());

  await waitFor(() => {
    expect(documentLinksChangedCallCount).toBe(1);
  });
});

test("container document discovery ignores callback identity churn", async () => {
  const discoveredDocuments = createDeferred<ReadonlyArray<DocumentSummary>>();
  const appliedCallbacks: string[] = [];
  let discoverDocumentsCallCount = 0;
  const baseAppData = createReadyExplorerDiscoveryAppData();
  const discoverDocuments: ContainerContents["discoverDocuments"] =
    async () => {
      discoverDocumentsCallCount += 1;
      return discoveredDocuments.promise;
    };

  const view = renderHook(
    ({ callbackVersion }: { callbackVersion: string }) =>
      useDiscoveredDocumentsSync({
        activeContainerId: "container-1",
        appData: baseAppData,
        discoverDocuments,
        hasUndiscoveredDocumentUpdates: () => false,
        knownDocumentIds: new Set(),
        mergeDocumentSummaries: () => {
          appliedCallbacks.push(`merge:${callbackVersion}`);
        },
        onDocumentLinksChanged: () => {
          appliedCallbacks.push(`links:${callbackVersion}`);
        },
        primeDiscoveredDocuments: () => {
          appliedCallbacks.push(`prime:${callbackVersion}`);
        },
      }),
    {
      initialProps: { callbackVersion: "first" },
      wrapper: StrictMode,
    },
  );

  await waitFor(() => {
    expect(discoverDocumentsCallCount).toBe(1);
  });

  view.rerender({ callbackVersion: "second" });
  view.rerender({ callbackVersion: "third" });
  expect(discoverDocumentsCallCount).toBe(1);

  discoveredDocuments.resolve([createDocumentSummary("document-1")]);
  await act(async () => {
    await discoveredDocuments.promise;
  });

  await waitFor(() => {
    expect(appliedCallbacks).toEqual([
      "merge:third",
      "links:third",
      "prime:third",
    ]);
  });
  expect(discoverDocumentsCallCount).toBe(1);
});

test("container document discovery skips a previously checked active container", async () => {
  let discoverDocumentsCallCount = 0;
  const baseAppData = createReadyExplorerDiscoveryAppData();
  const discoverDocuments: ContainerContents["discoverDocuments"] =
    async () => {
      discoverDocumentsCallCount += 1;
      return [];
    };

  const view = renderHook(
    ({ online }: { online: boolean }) =>
      useDiscoveredDocumentsSync({
        activeContainerId: "container-1",
        appData: {
          ...baseAppData,
          state: { ...baseAppData.state, online },
        },
        discoverDocuments,
        hasUndiscoveredDocumentUpdates: () => false,
        knownDocumentIds: new Set(),
        mergeDocumentSummaries: () => undefined,
        onDocumentLinksChanged: () => undefined,
        primeDiscoveredDocuments: () => undefined,
      }),
    {
      initialProps: { online: true },
      wrapper: StrictMode,
    },
  );

  await waitFor(() => {
    expect(discoverDocumentsCallCount).toBe(1);
  });

  view.rerender({ online: false });
  view.rerender({ online: true });
  await act(async () => {
    await Promise.resolve();
  });

  expect(discoverDocumentsCallCount).toBe(1);
});

test("container document discovery initializes the event frontier on active container changes", async () => {
  let discoverDocumentsCallCount = 0;
  let hasUndiscoveredDocumentUpdatesCallCount = 0;
  const baseAppData = createReadyExplorerDiscoveryAppData();
  const existingEvents = [
    {
      documentId: "unknown-document-1",
      id: "event-1",
      type: "document_update_created",
    },
  ] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"];
  const nextEvents = [
    ...existingEvents,
    {
      documentId: "unknown-document-2",
      id: "event-2",
      type: "document_update_created",
    },
  ] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"];
  const discoverDocuments: ContainerContents["discoverDocuments"] =
    async () => {
      discoverDocumentsCallCount += 1;
      return [];
    };
  const hasUndiscoveredDocumentUpdates: ContainerContents["hasUndiscoveredDocumentUpdates"] =
    () => {
      hasUndiscoveredDocumentUpdatesCallCount += 1;
      return true;
    };

  const view = renderHook(
    ({
      activeContainerId,
      events,
    }: {
      activeContainerId: string;
      events: UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"];
    }) =>
      useDiscoveredDocumentsSync({
        activeContainerId,
        appData: {
          ...baseAppData,
          state: { ...baseAppData.state, events },
        },
        discoverDocuments,
        hasUndiscoveredDocumentUpdates,
        knownDocumentIds: new Set(),
        mergeDocumentSummaries: () => undefined,
        onDocumentLinksChanged: () => undefined,
        primeDiscoveredDocuments: () => undefined,
      }),
    {
      initialProps: {
        activeContainerId: "container-1",
        events: existingEvents,
      },
      wrapper: StrictMode,
    },
  );

  await waitFor(() => {
    expect(discoverDocumentsCallCount).toBe(1);
  });
  expect(hasUndiscoveredDocumentUpdatesCallCount).toBe(0);

  view.rerender({
    activeContainerId: "container-2",
    events: existingEvents,
  });
  await waitFor(() => {
    expect(discoverDocumentsCallCount).toBe(2);
  });
  expect(hasUndiscoveredDocumentUpdatesCallCount).toBe(0);

  view.rerender({
    activeContainerId: "container-2",
    events: nextEvents,
  });
  await waitFor(() => {
    expect(discoverDocumentsCallCount).toBe(3);
  });
  expect(hasUndiscoveredDocumentUpdatesCallCount).toBe(1);
});

test("container document discovery suppresses update events for locally discovered ids", async () => {
  const discoveredDocuments = createDeferred<ReadonlyArray<DocumentSummary>>();
  let discoverDocumentsCallCount = 0;
  let documentLinksChangedCallCount = 0;
  const discoveredDocument = createDocumentSummary("document-1");
  const baseAppData = {
    auth: {
      isAuthenticated: true,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {},
      dbStatus: "ready",
      execSql: async () => {
        throw new Error("execSql should not be used by this test.");
      },
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => undefined,
      log: () => undefined,
      logError: () => undefined,
    },
  } as unknown as UseDiscoveredDocumentsSyncParams["appData"];
  let currentEvents =
    [] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"];
  const discoverDocuments: ContainerContents["discoverDocuments"] =
    async () => {
      discoverDocumentsCallCount += 1;
      return discoveredDocuments.promise;
    };
  const hasUndiscoveredDocumentUpdates: ContainerContents["hasUndiscoveredDocumentUpdates"] =
    (knownDocumentIds) =>
      currentEvents.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "documentId" in event &&
          typeof event.documentId === "string" &&
          !knownDocumentIds.has(event.documentId),
      );
  const mergeDocumentSummaries = () => undefined;
  const onDocumentLinksChanged = () => {
    documentLinksChangedCallCount += 1;
  };
  const primeDiscoveredDocuments = () => undefined;

  const view = renderHook(
    ({
      events,
    }: {
      events: UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"];
    }) => {
      currentEvents = events;
      return useDiscoveredDocumentsSync({
        activeContainerId: "container-1",
        appData: {
          ...baseAppData,
          state: { ...baseAppData.state, events },
        },
        discoverDocuments,
        hasUndiscoveredDocumentUpdates,
        knownDocumentIds: new Set(),
        mergeDocumentSummaries,
        onDocumentLinksChanged,
        primeDiscoveredDocuments,
      });
    },
    {
      initialProps: {
        events:
          [] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"],
      },
      wrapper: StrictMode,
    },
  );

  await waitFor(() => {
    expect(discoverDocumentsCallCount).toBe(1);
  });
  discoveredDocuments.resolve([discoveredDocument]);
  await act(async () => {
    await discoveredDocuments.promise;
  });
  await waitFor(() => {
    expect(documentLinksChangedCallCount).toBe(1);
  });

  view.rerender({
    events: [
      {
        documentId: discoveredDocument.documentId,
        id: "event-1",
        type: "document_update_created",
      },
    ] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"],
  });

  await act(async () => {
    await Promise.resolve();
  });
  expect(discoverDocumentsCallCount).toBe(1);
});

test("container document discovery evaluates each event frontier once per active container", async () => {
  let discoverDocumentsCallCount = 0;
  let currentEvents =
    [] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"];
  const baseAppData = createReadyExplorerDiscoveryAppData();
  const discoverDocuments: ContainerContents["discoverDocuments"] =
    async () => {
      discoverDocumentsCallCount += 1;
      return [];
    };
  const hasUndiscoveredDocumentUpdates: ContainerContents["hasUndiscoveredDocumentUpdates"] =
    (knownDocumentIds) =>
      currentEvents.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "documentId" in event &&
          typeof event.documentId === "string" &&
          !knownDocumentIds.has(event.documentId),
      );

  const view = renderHook(
    ({
      events,
    }: {
      events: UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"];
    }) => {
      currentEvents = events;
      return useDiscoveredDocumentsSync({
        activeContainerId: "container-1",
        appData: {
          ...baseAppData,
          state: { ...baseAppData.state, events },
        },
        discoverDocuments,
        hasUndiscoveredDocumentUpdates,
        knownDocumentIds: new Set(),
        mergeDocumentSummaries: () => undefined,
        onDocumentLinksChanged: () => undefined,
        primeDiscoveredDocuments: () => undefined,
      });
    },
    {
      initialProps: {
        events:
          [] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"],
      },
      wrapper: StrictMode,
    },
  );

  await waitFor(() => {
    expect(discoverDocumentsCallCount).toBe(1);
  });

  view.rerender({
    events: [
      {
        documentId: "unknown-document-1",
        id: "event-1",
        type: "document_update_created",
      },
    ] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"],
  });
  await waitFor(() => {
    expect(discoverDocumentsCallCount).toBe(2);
  });

  view.rerender({
    events: [
      {
        documentId: "unknown-document-1",
        id: "event-1",
        type: "document_update_created",
      },
    ] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"],
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(discoverDocumentsCallCount).toBe(2);

  view.rerender({
    events: [
      {
        documentId: "unknown-document-1",
        id: "event-1",
        type: "document_update_created",
      },
      {
        documentId: "unknown-document-2",
        id: "event-2",
        type: "document_update_created",
      },
    ] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"],
  });
  await waitFor(() => {
    expect(discoverDocumentsCallCount).toBe(3);
  });

  view.rerender({
    events: [
      {
        documentId: "unknown-document-1",
        id: "event-1",
        type: "document_update_created",
      },
      {
        documentId: "unknown-document-2",
        id: "event-2",
        type: "document_update_created",
      },
      {
        documentId: "unknown-document-1",
        id: "event-3",
        type: "document_update_created",
      },
    ] as UseDiscoveredDocumentsSyncParams["appData"]["state"]["events"],
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(discoverDocumentsCallCount).toBe(3);
});

test("manual explorer refresh reuses an in-flight refresh", async () => {
  const refreshed = createDeferred<boolean>();
  let documentLinksChangedCallCount = 0;
  let mergeDocumentSummariesCallCount = 0;
  let primeDiscoveredDocumentsCallCount = 0;
  let refreshCallCount = 0;
  let refreshDocumentsCallCount = 0;
  const view = renderHook(() =>
    useExplorerRefreshAction({
      mergeDocumentSummaries: () => {
        mergeDocumentSummariesCallCount += 1;
      },
      onDocumentLinksChanged: () => {
        documentLinksChangedCallCount += 1;
      },
      primeDiscoveredDocuments: () => {
        primeDiscoveredDocumentsCallCount += 1;
      },
      refresh: () => {
        refreshCallCount += 1;
        return refreshed.promise;
      },
      refreshDocuments: async () => {
        refreshDocumentsCallCount += 1;
        return [];
      },
    }),
  );

  let firstRefresh: Promise<boolean> | undefined;
  let secondRefresh: Promise<boolean> | undefined;
  act(() => {
    firstRefresh = view.result.current.handleRefresh();
    secondRefresh = view.result.current.handleRefresh();
  });

  expect(firstRefresh).toBe(secondRefresh);
  expect(refreshCallCount).toBe(1);

  await act(async () => {
    refreshed.resolve(true);
    await firstRefresh;
  });

  await expect(firstRefresh).resolves.toBe(true);
  expect(refreshDocumentsCallCount).toBe(1);
  expect(mergeDocumentSummariesCallCount).toBe(0);
  expect(documentLinksChangedCallCount).toBe(0);
  expect(primeDiscoveredDocumentsCallCount).toBe(0);
  await waitFor(() => {
    expect(view.result.current.isRefreshing).toBe(false);
  });
});
