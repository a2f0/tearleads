import { afterEach, expect, test } from "bun:test";
import type { TearleadsContainerContents } from "@tearleads/client-sdk";
import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { createDomainScope } from "@tearleads/client-sdk/workflows/sync";
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

afterEach(() => {
  cleanup();
});

test("container document discovery reuses an in-flight run for repeated effect triggers", async () => {
  const listedDocuments = createDeferred<ListContainerDocumentsResponse>();
  const applyOrder: string[] = [];
  let listContainerDocumentsCallCount = 0;
  let documentLinksChangedCallCount = 0;
  const baseAppData = {
    blobStore: {},
    cacheReferencedPrincipalPolicies: async () => undefined,
    dbStatus: "ready",
    domainScope: createDomainScope(),
    encapsulationKeyPair: null,
    events: [],
    execSql: async () => {
      throw new Error("execSql should not be used by this test.");
    },
    isAuthenticated: true,
    log: () => undefined,
    online: true,
    organizationId: null,
    signingFingerprint: null,
    signingKeyPair: null,
    userId: null,
  } as unknown as UseDiscoveredDocumentsSyncParams["appData"];
  const mergeDocumentSummaries = (
    _nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => {
    applyOrder.push("merge");
  };
  const discoverDocuments: TearleadsContainerContents["discoverDocuments"] =
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
  ] as UseDiscoveredDocumentsSyncParams["appData"]["events"];

  const view = renderHook(
    ({
      events,
    }: {
      events: UseDiscoveredDocumentsSyncParams["appData"]["events"];
    }) =>
      useDiscoveredDocumentsSync({
        activeContainerId: "container-1",
        appData: {
          ...baseAppData,
          events,
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
        events: [] as UseDiscoveredDocumentsSyncParams["appData"]["events"],
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
    blobStore: {},
    cacheReferencedPrincipalPolicies: async () => undefined,
    dbStatus: "ready",
    domainScope: createDomainScope(),
    encapsulationKeyPair: null,
    events: [],
    execSql: async () => {
      throw new Error("execSql should not be used by this test.");
    },
    isAuthenticated: true,
    log: () => undefined,
    online: true,
    organizationId: null,
    signingFingerprint: null,
    signingKeyPair: null,
    userId: null,
  } as unknown as UseDiscoveredDocumentsSyncParams["appData"];
  const mergeDocumentSummaries = (
    _nextDocuments: ReadonlyArray<DocumentSummary>,
  ) => undefined;
  const createDiscoverDocuments =
    (
      listContainerDocuments: () => Promise<ListContainerDocumentsResponse>,
    ): TearleadsContainerContents["discoverDocuments"] =>
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
      discoverDocuments: TearleadsContainerContents["discoverDocuments"];
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
