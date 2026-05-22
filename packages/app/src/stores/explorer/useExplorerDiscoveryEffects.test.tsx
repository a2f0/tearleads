import { afterEach, expect, test } from "bun:test";
import type { TearleadsContainerContents } from "@tearleads/client-sdk";
import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import { createDomainScope } from "@tearleads/client-sdk/workflows/sync";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { ExplorerDocumentReadModel } from "./documentReadModel";
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

function createDocumentReadModel(): ExplorerDocumentReadModel {
  return {
    applyContainerDocumentTombstones: async () => [],
    listContainerDocumentSidebarWindow: async () => ({
      rows: [],
      totalCount: 0,
    }),
    listContainerItemWindow: async () => ({ rows: [], totalCount: 0 }),
    loadDocumentSyncState: async () => null,
    loadDocumentSummary: async () => null,
    loadContainerDocumentWatermark: async () => null,
    listLinkedContainerIdsByDocumentIds: async () => new Map(),
    replaceDocumentLinks: async () => undefined,
    replaceDocumentLinksBatch: async () => undefined,
    saveContainerDocumentWatermark: async () => undefined,
    upsertDiscoveredDocuments: async () => [],
  };
}

afterEach(() => {
  cleanup();
});

test("container document discovery reuses an in-flight run for repeated effect triggers", async () => {
  const listedDocuments = createDeferred<ListContainerDocumentsResponse>();
  let listContainerDocumentsCallCount = 0;
  let replaceDocumentLinksCallCount = 0;
  const documentReadModel = createDocumentReadModel();
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
  const applyContainerDocumentTombstones = async () => [];
  const replaceDocumentLinksBatch = async () => {
    replaceDocumentLinksCallCount += 1;
  };
  const discoverDocuments: TearleadsContainerContents["discoverDocuments"] =
    async (input) => {
      listContainerDocumentsCallCount += 1;
      await listedDocuments.promise;
      await input.replaceDocumentLinksBatch([]);
      return [];
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
        applyContainerDocumentTombstones,
        discoverDocuments,
        documentReadModel,
        knownDocumentIds: new Set(),
        mergeDocumentSummaries,
        primeDiscoveredDocuments: () => undefined,
        replaceDocumentLinksBatch,
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
    expect(replaceDocumentLinksCallCount).toBe(1);
  });
});

test("container document discovery starts a new run when discovery dependencies change", async () => {
  const firstListedDocuments = createDeferred<ListContainerDocumentsResponse>();
  const secondListedDocuments =
    createDeferred<ListContainerDocumentsResponse>();
  let firstListContainerDocumentsCallCount = 0;
  let secondListContainerDocumentsCallCount = 0;
  let replaceDocumentLinksCallCount = 0;
  const documentReadModel = createDocumentReadModel();
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
  const applyContainerDocumentTombstones = async () => [];
  const replaceDocumentLinksBatch = async () => {
    replaceDocumentLinksCallCount += 1;
  };
  const createDiscoverDocuments =
    (
      listContainerDocuments: () => Promise<ListContainerDocumentsResponse>,
    ): TearleadsContainerContents["discoverDocuments"] =>
    async (input) => {
      await listContainerDocuments();
      await input.replaceDocumentLinksBatch([]);
      return [];
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
        applyContainerDocumentTombstones,
        discoverDocuments,
        documentReadModel,
        knownDocumentIds: new Set(),
        mergeDocumentSummaries,
        primeDiscoveredDocuments: () => undefined,
        replaceDocumentLinksBatch,
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
    expect(replaceDocumentLinksCallCount).toBe(2);
  });
});

test("manual explorer refresh reuses an in-flight refresh", async () => {
  const refreshed = createDeferred<boolean>();
  let refreshCallCount = 0;
  let refreshDocumentsCallCount = 0;
  const documentReadModel = createDocumentReadModel();
  const view = renderHook(() =>
    useExplorerRefreshAction({
      applyContainerDocumentTombstones: async () => [],
      documentReadModel,
      mergeDocumentSummaries: () => undefined,
      primeDiscoveredDocuments: () => undefined,
      refresh: () => {
        refreshCallCount += 1;
        return refreshed.promise;
      },
      refreshDocuments: async () => {
        refreshDocumentsCallCount += 1;
        return [];
      },
      replaceDocumentLinksBatch: async () => undefined,
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
  await waitFor(() => {
    expect(view.result.current.isRefreshing).toBe(false);
  });
});
