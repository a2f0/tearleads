import { expect, test } from "bun:test";
import type {
  ReferencedPrincipalStateResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/documents/documentSummary";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
  discoverContainerDocumentsFromApi,
  hasUndiscoveredDocumentUpdateEvent,
  listAllRemoteContainerIds,
  listAllRemoteContainerIdsFromApi,
  refreshAllContainerDocumentsFromApi,
} from "./documentDiscovery";
import {
  createDiscoveryParentLaneBatchMock,
  nullContainerDocumentWatermarks,
} from "./documentDiscovery.testUtils";

type CapturedInput = Omit<DiscoveredDocumentInput, "accessStateHash"> & {
  accessStateHash: string;
};

function listContainerDocumentsResponse(
  items: ReadonlyArray<{
    createdAt: string;
    currentAccessEpoch: number;
    currentAccessStateHash: string;
    id: string;
    linkedContainerIds: string[];
    referencedPrincipals?: ReferencedPrincipalStateResponse[];
    updatedAt: string;
  }>,
  overrides: Partial<{
    hasMore: boolean;
    nextWatermark: SyncWatermark | null;
    tombstones: ReadonlyArray<{
      containerId: string;
      documentId: string;
      updatedAt: string;
    }>;
  }> = {},
) {
  const lastItem = items.at(-1);
  return {
    hasMore: false,
    items: items.map((item) => ({
      ...item,
      referencedPrincipals: item.referencedPrincipals ?? [],
    })),
    nextWatermark: lastItem
      ? { id: lastItem.id, updatedAt: lastItem.updatedAt }
      : null,
    tombstones: [],
    ...overrides,
  };
}

function captureInputs(
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): CapturedInput[] {
  return inputs.map((input) => {
    if (
      typeof input.accessStateHash !== "string" ||
      input.accessStateHash.length === 0
    ) {
      throw new Error("Expected document hash.");
    }

    return {
      ...input,
      accessStateHash: input.accessStateHash,
    };
  });
}

test("unknown document update events trigger rediscovery for shared container notes", async () => {
  const cachedPrincipalReferences: Array<
    ReadonlyArray<ReferencedPrincipalStateResponse>
  > = [];
  const replaceDocumentLinksBatchCalls: Array<
    ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>
  > = [];
  const upsertDiscoveredDocumentsCalls: Array<ReadonlyArray<CapturedInput>> =
    [];
  const knownDocumentIds = new Set<string>();
  const events = [
    {
      documentId: "peer-note-document",
      id: "event-1",
      type: "document_update_created",
    },
  ];

  expect(hasUndiscoveredDocumentUpdateEvent(events, knownDocumentIds)).toBe(
    true,
  );

  const discovered = await discoverContainerDocuments({
    ...nullContainerDocumentWatermarks,
    cacheReferencedPrincipalPolicies: async (references) => {
      cachedPrincipalReferences.push(references);
    },
    containerId: "shared-container",
    listContainerDocuments: async () =>
      listContainerDocumentsResponse([
        {
          createdAt: "2026-04-06T12:00:00.000Z",
          currentAccessEpoch: 1,
          currentAccessStateHash: "access-state-hash-1",
          id: "peer-note-document",
          linkedContainerIds: ["shared-container"],
          referencedPrincipals: [
            {
              keyEpoch: 1,
              keyFingerprint: "key-fingerprint-1",
              principalId: "group-1",
              principalType: "group",
              stateHash: "state-hash-1",
              version: 1,
            },
          ],
          updatedAt: "2026-04-06T12:00:00.000Z",
        },
      ]),
    replaceDocumentLinksBatch: async (inputs) => {
      replaceDocumentLinksBatchCalls.push(inputs);
    },
    upsertDiscoveredDocuments: async (inputs) => {
      const capturedInputs = captureInputs(inputs);
      upsertDiscoveredDocumentsCalls.push(capturedInputs);
      const summaries: DocumentSummary[] = capturedInputs.map((input) => ({
        id: `document-${input.documentId}`,
        containerId: input.containerId,
        documentId: input.documentId,
        title: "Peer shared note",
        updatedAt: input.createdAt,
      }));
      return summaries;
    },
  });

  expect(replaceDocumentLinksBatchCalls).toEqual([
    [
      {
        containerIds: ["shared-container"],
        documentId: "peer-note-document",
      },
    ],
  ]);
  expect(upsertDiscoveredDocumentsCalls).toEqual([
    [
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-1",
        containerId: "shared-container",
        createdAt: "2026-04-06T12:00:00.000Z",
        documentId: "peer-note-document",
        linkedContainerIds: ["shared-container"],
      },
    ],
  ]);
  expect(cachedPrincipalReferences).toEqual([
    [
      {
        keyEpoch: 1,
        keyFingerprint: "key-fingerprint-1",
        principalId: "group-1",
        principalType: "group",
        stateHash: "state-hash-1",
        version: 1,
      },
    ],
  ]);
  expect(discovered).toEqual([
    {
      id: "document-peer-note-document",
      containerId: "shared-container",
      documentId: "peer-note-document",
      title: "Peer shared note",
      updatedAt: "2026-04-06T12:00:00.000Z",
    },
  ]);
});

test("container document discovery resumes from stored watermark and advances after local apply", async () => {
  const listContainerDocumentsCalls: Array<{
    containerId: string;
    watermark: SyncWatermark | null | undefined;
  }> = [];
  const saveContainerDocumentWatermarkCalls: Array<{
    containerId: string;
    watermark: SyncWatermark;
  }> = [];
  const applyOrder: string[] = [];
  const discovered = await discoverContainerDocuments({
    applyContainerDocumentTombstones: async () => [],
    containerId: "shared-container",
    loadContainerDocumentWatermark: async () => ({
      id: "old-document",
      updatedAt: "2026-04-06T11:00:00.000Z",
    }),
    listContainerDocuments: async (containerId, options) => {
      listContainerDocumentsCalls.push({
        containerId,
        watermark: options?.watermark,
      });

      return listContainerDocumentsResponse([
        {
          createdAt: "2026-04-06T12:00:00.000Z",
          currentAccessEpoch: 1,
          currentAccessStateHash: "access-state-hash-1",
          id: "peer-note-document",
          linkedContainerIds: ["shared-container"],
          updatedAt: "2026-04-06T12:00:00.000Z",
        },
      ]);
    },
    replaceDocumentLinksBatch: async () => {
      applyOrder.push("replace-links");
    },
    saveContainerDocumentWatermark: async (containerId, watermark) => {
      applyOrder.push("save-watermark");
      saveContainerDocumentWatermarkCalls.push({ containerId, watermark });
    },
    upsertDiscoveredDocuments: async (inputs) => {
      applyOrder.push("upsert-documents");
      return inputs.map<DocumentSummary>((input) => ({
        id: `document-${input.documentId}`,
        containerId: input.containerId,
        documentId: input.documentId,
        title: input.documentId,
        updatedAt: input.createdAt,
      }));
    },
  });

  expect(listContainerDocumentsCalls).toEqual([
    {
      containerId: "shared-container",
      watermark: {
        id: "old-document",
        updatedAt: "2026-04-06T11:00:00.000Z",
      },
    },
  ]);
  expect(applyOrder).toEqual([
    "upsert-documents",
    "replace-links",
    "save-watermark",
  ]);
  expect(saveContainerDocumentWatermarkCalls).toEqual([
    {
      containerId: "shared-container",
      watermark: {
        id: "peer-note-document",
        updatedAt: "2026-04-06T12:00:00.000Z",
      },
    },
  ]);
  expect(discovered).toEqual([
    {
      id: "document-peer-note-document",
      containerId: "shared-container",
      documentId: "peer-note-document",
      title: "peer-note-document",
      updatedAt: "2026-04-06T12:00:00.000Z",
    },
  ]);
});

test("container document discovery API facade lists documents through the api client", async () => {
  const listContainerDocumentsCalls: Array<{
    containerId: string;
    watermark: SyncWatermark | null | undefined;
  }> = [];

  await discoverContainerDocumentsFromApi({
    ...nullContainerDocumentWatermarks,
    apiClient: {
      listContainerDocuments: async (containerId, options) => {
        listContainerDocumentsCalls.push({
          containerId,
          watermark: options?.watermark,
        });
        return listContainerDocumentsResponse([]);
      },
    },
    containerId: "shared-container",
    loadContainerDocumentWatermark: async () => ({
      id: "old-document",
      updatedAt: "2026-04-06T11:00:00.000Z",
    }),
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
  });

  expect(listContainerDocumentsCalls).toEqual([
    {
      containerId: "shared-container",
      watermark: {
        id: "old-document",
        updatedAt: "2026-04-06T11:00:00.000Z",
      },
    },
  ]);
});

test("container document discovery does not advance watermark when local apply fails", async () => {
  const saveContainerDocumentWatermarkCalls: SyncWatermark[] = [];

  await expect(
    discoverContainerDocuments({
      applyContainerDocumentTombstones: async () => [],
      containerId: "shared-container",
      loadContainerDocumentWatermark: async () => null,
      listContainerDocuments: async () =>
        listContainerDocumentsResponse([
          {
            createdAt: "2026-04-06T12:00:00.000Z",
            currentAccessEpoch: 1,
            currentAccessStateHash: "access-state-hash-1",
            id: "peer-note-document",
            linkedContainerIds: ["shared-container"],
            updatedAt: "2026-04-06T12:00:00.000Z",
          },
        ]),
      replaceDocumentLinksBatch: async () => {},
      saveContainerDocumentWatermark: async (_containerId, watermark) => {
        saveContainerDocumentWatermarkCalls.push(watermark);
      },
      upsertDiscoveredDocuments: async () => {
        throw new Error("upsert failed");
      },
    }),
  ).rejects.toThrow("upsert failed");

  expect(saveContainerDocumentWatermarkCalls).toEqual([]);
});

test("container document discovery applies tombstones before advancing watermark", async () => {
  const applyOrder: string[] = [];
  const appliedTombstones: Array<
    ReadonlyArray<{
      containerId: string;
      documentId: string;
      updatedAt: string;
    }>
  > = [];
  const saveContainerDocumentWatermarkCalls: SyncWatermark[] = [];

  const discovered = await discoverContainerDocuments({
    applyContainerDocumentTombstones: async (tombstones) => {
      applyOrder.push("apply-tombstones");
      appliedTombstones.push(tombstones);
      return [
        {
          id: "deleted-document",
          containerId: null,
          documentId: "deleted-document",
          title: "Deleted document",
          updatedAt: "2026-04-06T12:00:00.000Z",
        },
      ];
    },
    containerId: "shared-container",
    loadContainerDocumentWatermark: async () => null,
    listContainerDocuments: async () =>
      listContainerDocumentsResponse([], {
        nextWatermark: {
          id: "deleted-document",
          updatedAt: "2026-04-06T12:00:00.000Z",
        },
        tombstones: [
          {
            containerId: "shared-container",
            documentId: "deleted-document",
            updatedAt: "2026-04-06T12:00:00.000Z",
          },
        ],
      }),
    replaceDocumentLinksBatch: async () => {
      applyOrder.push("replace-links");
    },
    saveContainerDocumentWatermark: async (_containerId, watermark) => {
      applyOrder.push("save-watermark");
      saveContainerDocumentWatermarkCalls.push(watermark);
    },
    upsertDiscoveredDocuments: async () => {
      applyOrder.push("upsert-documents");
      return [];
    },
  });

  expect(applyOrder).toEqual([
    "upsert-documents",
    "replace-links",
    "apply-tombstones",
    "save-watermark",
  ]);
  expect(appliedTombstones).toEqual([
    [
      {
        containerId: "shared-container",
        documentId: "deleted-document",
        updatedAt: "2026-04-06T12:00:00.000Z",
      },
    ],
  ]);
  expect(saveContainerDocumentWatermarkCalls).toEqual([
    {
      id: "deleted-document",
      updatedAt: "2026-04-06T12:00:00.000Z",
    },
  ]);
  expect(discovered).toEqual([
    {
      id: "deleted-document",
      containerId: null,
      documentId: "deleted-document",
      title: "Deleted document",
      updatedAt: "2026-04-06T12:00:00.000Z",
    },
  ]);
});

test("container document discovery does not advance watermark when tombstone apply fails", async () => {
  const saveContainerDocumentWatermarkCalls: SyncWatermark[] = [];

  await expect(
    discoverContainerDocuments({
      applyContainerDocumentTombstones: async () => {
        throw new Error("tombstone apply failed");
      },
      containerId: "shared-container",
      loadContainerDocumentWatermark: async () => null,
      listContainerDocuments: async () =>
        listContainerDocumentsResponse([], {
          nextWatermark: {
            id: "deleted-document",
            updatedAt: "2026-04-06T12:00:00.000Z",
          },
          tombstones: [
            {
              containerId: "shared-container",
              documentId: "deleted-document",
              updatedAt: "2026-04-06T12:00:00.000Z",
            },
          ],
        }),
      replaceDocumentLinksBatch: async () => {},
      saveContainerDocumentWatermark: async (_containerId, watermark) => {
        saveContainerDocumentWatermarkCalls.push(watermark);
      },
      upsertDiscoveredDocuments: async () => [],
    }),
  ).rejects.toThrow("tombstone apply failed");

  expect(saveContainerDocumentWatermarkCalls).toEqual([]);
});

test("manual refresh can discover documents across all visible containers", async () => {
  const cachedPrincipalReferences: Array<
    ReadonlyArray<ReferencedPrincipalStateResponse>
  > = [];
  const listContainerDocumentsCalls: string[] = [];
  const applyOrder: string[] = [];
  const replaceDocumentLinksBatchCalls: Array<
    ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>
  > = [];
  const upsertDiscoveredDocumentsCalls: Array<ReadonlyArray<CapturedInput>> =
    [];
  const discovered = await discoverAllContainerDocuments({
    ...nullContainerDocumentWatermarks,
    cacheReferencedPrincipalPolicies: async (references) => {
      cachedPrincipalReferences.push(references);
    },
    containerIds: ["container-a", "container-b", "container-a"],
    listContainerDocuments: async (containerId) => {
      listContainerDocumentsCalls.push(containerId);
      if (containerId === "container-a") {
        return listContainerDocumentsResponse([
          {
            createdAt: "2026-04-06T12:00:00.000Z",
            currentAccessEpoch: 1,
            currentAccessStateHash: "access-state-hash-a",
            id: "document-a",
            linkedContainerIds: ["container-a"],
            referencedPrincipals: [
              {
                keyEpoch: 1,
                keyFingerprint: "key-fingerprint-a",
                principalId: "group-a",
                principalType: "group",
                stateHash: "state-hash-a",
                version: 1,
              },
            ],
            updatedAt: "2026-04-06T12:00:00.000Z",
          },
        ]);
      }

      return listContainerDocumentsResponse([
        {
          createdAt: "2026-04-06T12:05:00.000Z",
          currentAccessEpoch: 2,
          currentAccessStateHash: "access-state-hash-b",
          id: "document-b",
          linkedContainerIds: ["container-b"],
          referencedPrincipals: [
            {
              keyEpoch: 2,
              keyFingerprint: "key-fingerprint-b",
              principalId: "organization-b",
              principalType: "organization",
              stateHash: "state-hash-b",
              version: 3,
            },
          ],
          updatedAt: "2026-04-06T12:05:00.000Z",
        },
      ]);
    },
    replaceDocumentLinksBatch: async (inputs) => {
      applyOrder.push("replace-links");
      replaceDocumentLinksBatchCalls.push(inputs);
    },
    upsertDiscoveredDocuments: async (inputs) => {
      applyOrder.push("upsert-documents");
      const capturedInputs = captureInputs(inputs);
      upsertDiscoveredDocumentsCalls.push(capturedInputs);
      return capturedInputs.map<DocumentSummary>((input) => ({
        id: `document-${input.documentId}`,
        containerId: input.containerId,
        documentId: input.documentId,
        title: input.documentId,
        updatedAt: input.createdAt,
      }));
    },
  });
  expect(listContainerDocumentsCalls).toEqual(["container-a", "container-b"]);
  expect(applyOrder).toEqual(["upsert-documents", "replace-links"]);
  expect(replaceDocumentLinksBatchCalls).toEqual([
    [
      {
        containerIds: ["container-a"],
        documentId: "document-a",
      },
      {
        containerIds: ["container-b"],
        documentId: "document-b",
      },
    ],
  ]);
  expect(upsertDiscoveredDocumentsCalls).toEqual([
    [
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-a",
        containerId: "container-a",
        createdAt: "2026-04-06T12:00:00.000Z",
        documentId: "document-a",
        effectiveAccessLevel: "read",
        linkedContainerIds: ["container-a"],
      },
      {
        accessEpoch: 2,
        accessStateHash: "access-state-hash-b",
        containerId: "container-b",
        createdAt: "2026-04-06T12:05:00.000Z",
        documentId: "document-b",
        effectiveAccessLevel: "read",
        linkedContainerIds: ["container-b"],
      },
    ],
  ]);
  expect(cachedPrincipalReferences).toEqual([
    [
      {
        keyEpoch: 1,
        keyFingerprint: "key-fingerprint-a",
        principalId: "group-a",
        principalType: "group",
        stateHash: "state-hash-a",
        version: 1,
      },
      {
        keyEpoch: 2,
        keyFingerprint: "key-fingerprint-b",
        principalId: "organization-b",
        principalType: "organization",
        stateHash: "state-hash-b",
        version: 3,
      },
    ],
  ]);
  expect(discovered).toEqual([
    {
      id: "document-document-a",
      containerId: "container-a",
      documentId: "document-a",
      title: "document-a",
      updatedAt: "2026-04-06T12:00:00.000Z",
    },
    {
      id: "document-document-b",
      containerId: "container-b",
      documentId: "document-b",
      title: "document-b",
      updatedAt: "2026-04-06T12:05:00.000Z",
    },
  ]);
});

test("manual refresh deduplicates principal references and document inputs", async () => {
  const referencedPrincipal: ReferencedPrincipalStateResponse = {
    keyEpoch: 1,
    keyFingerprint: "shared-key-fingerprint",
    principalId: "shared-group",
    principalType: "group",
    stateHash: "shared-state-hash",
    version: 1,
  };
  const cachedPrincipalReferences: Array<
    ReadonlyArray<ReferencedPrincipalStateResponse>
  > = [];
  const replaceDocumentLinksBatchCalls: Array<
    ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>
  > = [];
  const upsertDiscoveredDocumentsCalls: Array<ReadonlyArray<CapturedInput>> =
    [];

  await discoverAllContainerDocuments({
    ...nullContainerDocumentWatermarks,
    cacheReferencedPrincipalPolicies: async (references) => {
      cachedPrincipalReferences.push(references);
    },
    containerIds: ["container-a", "container-b"],
    listContainerDocuments: async (containerId) =>
      listContainerDocumentsResponse([
        {
          createdAt: "2026-04-06T12:00:00.000Z",
          currentAccessEpoch: 1,
          currentAccessStateHash: "shared-access-state-hash",
          id: "shared-document",
          linkedContainerIds: [containerId],
          referencedPrincipals: [referencedPrincipal],
          updatedAt: "2026-04-06T12:00:00.000Z",
        },
      ]),
    replaceDocumentLinksBatch: async (inputs) => {
      replaceDocumentLinksBatchCalls.push(inputs);
    },
    upsertDiscoveredDocuments: async (inputs) => {
      const capturedInputs = captureInputs(inputs);
      upsertDiscoveredDocumentsCalls.push(capturedInputs);
      return [];
    },
  });
  expect(cachedPrincipalReferences).toEqual([[referencedPrincipal]]);
  expect(replaceDocumentLinksBatchCalls).toEqual([
    [
      {
        containerIds: ["container-a", "container-b"],
        documentId: "shared-document",
      },
    ],
  ]);
  expect(upsertDiscoveredDocumentsCalls).toEqual([
    [
      {
        accessEpoch: 1,
        accessStateHash: "shared-access-state-hash",
        containerId: "container-a",
        createdAt: "2026-04-06T12:00:00.000Z",
        documentId: "shared-document",
        effectiveAccessLevel: "read",
        linkedContainerIds: ["container-a", "container-b"],
      },
    ],
  ]);
});

test("manual refresh ignores empty container ids", async () => {
  const listContainerDocumentsCalls: string[] = [];
  const replaceDocumentLinksBatchCalls: Array<
    ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>
  > = [];

  await discoverAllContainerDocuments({
    ...nullContainerDocumentWatermarks,
    containerIds: ["", "container-a", "container-a"],
    listContainerDocuments: async (containerId) => {
      listContainerDocumentsCalls.push(containerId);
      return listContainerDocumentsResponse([]);
    },
    replaceDocumentLinksBatch: async (inputs) => {
      replaceDocumentLinksBatchCalls.push(inputs);
    },
    upsertDiscoveredDocuments: async () => [],
  });

  expect(listContainerDocumentsCalls).toEqual(["container-a"]);
  expect(replaceDocumentLinksBatchCalls).toEqual([]);
});

test("manual refresh lists remote container ids across paged parent lanes", async () => {
  const firstRootWatermark = {
    id: "root-page-1",
    updatedAt: "2026-04-06T12:00:00.000Z",
  };
  const parentLaneCalls: Array<{
    parentId: string | null;
    watermark?: SyncWatermark | null;
  }> = [];

  const containerIds = await listAllRemoteContainerIds(
    createDiscoveryParentLaneBatchMock(async (options) => {
      parentLaneCalls.push(options);

      if (options.parentId === null && !options.watermark) {
        return {
          hasMore: true,
          items: [{ id: "root" }, { id: "container-a" }],
          nextWatermark: firstRootWatermark,
        };
      }

      if (
        options.parentId === null &&
        options.watermark?.id === firstRootWatermark.id
      ) {
        return {
          hasMore: false,
          items: [{ id: "container-b" }],
          nextWatermark: null,
        };
      }

      if (options.parentId === "root") {
        return {
          hasMore: false,
          items: [{ id: "root-child" }],
          nextWatermark: null,
        };
      }

      if (options.parentId === "container-a") {
        return {
          hasMore: false,
          items: [{ id: "container-a-child" }],
          nextWatermark: null,
        };
      }

      return {
        hasMore: false,
        items: [],
        nextWatermark: null,
      };
    }),
  );

  expect(containerIds).toEqual([
    "root",
    "container-a",
    "container-b",
    "root-child",
    "container-a-child",
  ]);
  expect(parentLaneCalls).toEqual([
    { parentId: null, watermark: null },
    { parentId: null, watermark: firstRootWatermark },
    { parentId: "root", watermark: null },
    { parentId: "container-a", watermark: null },
    { parentId: "container-b", watermark: null },
    { parentId: "root-child", watermark: null },
    { parentId: "container-a-child", watermark: null },
  ]);
});

test("manual refresh API facade lists remote container ids through the api client", async () => {
  const parentLaneCalls: Array<{
    parentId: string | null;
    watermark?: SyncWatermark | null;
  }> = [];

  const containerIds = await listAllRemoteContainerIdsFromApi({
    listContainerParentLanes: createDiscoveryParentLaneBatchMock(
      async (options) => {
        parentLaneCalls.push(options);
        return {
          hasMore: false,
          items: options.parentId === null ? [{ id: "container-a" }] : [],
          nextWatermark: null,
        };
      },
    ),
  });

  expect(containerIds).toEqual(["container-a"]);
  expect(parentLaneCalls).toEqual([
    { parentId: null, watermark: null },
    { parentId: "container-a", watermark: null },
  ]);
});

test("manual refresh API facade discovers documents for every remote container", async () => {
  const parentLaneCalls: Array<{
    parentId: string | null;
    watermark?: SyncWatermark | null;
  }> = [];
  const listContainerDocumentsCalls: string[] = [];
  const replaceDocumentLinksBatchCalls: Array<
    ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>
  > = [];

  const discovered = await refreshAllContainerDocumentsFromApi({
    ...nullContainerDocumentWatermarks,
    apiClient: {
      listContainerDocuments: async (containerId) => {
        listContainerDocumentsCalls.push(containerId);
        return listContainerDocumentsResponse([
          {
            createdAt: "2026-05-01T12:00:00.000Z",
            currentAccessEpoch: 1,
            currentAccessStateHash: `access-${containerId}`,
            id: `document-${containerId}`,
            linkedContainerIds: [containerId],
            updatedAt: "2026-05-01T12:30:00.000Z",
          },
        ]);
      },
      listContainerParentLanes: createDiscoveryParentLaneBatchMock(
        async (options) => {
          parentLaneCalls.push(options);
          return {
            hasMore: false,
            items: options.parentId === null ? [{ id: "container-a" }] : [],
            nextWatermark: null,
          };
        },
      ),
    },
    replaceDocumentLinksBatch: async (inputs) => {
      replaceDocumentLinksBatchCalls.push(inputs);
    },
    upsertDiscoveredDocuments: async (inputs) =>
      inputs.map(
        (input): DocumentSummary => ({
          id: `local-${input.documentId}`,
          containerId: input.containerId,
          documentId: input.documentId,
          title: input.documentId,
          updatedAt: "2026-05-01T12:30:00.000Z",
        }),
      ),
  });

  expect(discovered).toEqual([
    {
      id: "local-document-container-a",
      containerId: "container-a",
      documentId: "document-container-a",
      title: "document-container-a",
      updatedAt: "2026-05-01T12:30:00.000Z",
    },
  ]);
  expect(parentLaneCalls).toEqual([
    { parentId: null, watermark: null },
    { parentId: "container-a", watermark: null },
  ]);
  expect(listContainerDocumentsCalls).toEqual(["container-a"]);
  expect(replaceDocumentLinksBatchCalls).toEqual([
    [
      {
        containerIds: ["container-a"],
        documentId: "document-container-a",
      },
    ],
  ]);
});

test("manual refresh API facade stops when remote container listing is unavailable", async () => {
  let listContainerDocumentsCallCount = 0;

  const discovered = await refreshAllContainerDocumentsFromApi({
    ...nullContainerDocumentWatermarks,
    apiClient: {
      listContainerDocuments: async () => {
        listContainerDocumentsCallCount += 1;
        return listContainerDocumentsResponse([]);
      },
      listContainerParentLanes: async () => null,
    },
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
  });

  expect(discovered).toBeNull();
  expect(listContainerDocumentsCallCount).toBe(0);
});

test("manual refresh container listing stops on unavailable pages", async () => {
  await expect(listAllRemoteContainerIds(async () => null)).resolves.toBeNull();

  await expect(
    listAllRemoteContainerIds(
      createDiscoveryParentLaneBatchMock(async () => ({
        hasMore: true,
        items: [{ id: "container-a" }],
        nextWatermark: null,
      })),
    ),
  ).resolves.toBeNull();
});

test("manual refresh limits concurrent container document lane fetches", async () => {
  const containerIds = Array.from(
    { length: 9 },
    (_, index) => `container-${index}`,
  );
  const listContainerDocumentsCalls: string[] = [];
  let activeListContainerDocumentsCalls = 0;
  let maxActiveListContainerDocumentsCalls = 0;

  await discoverAllContainerDocuments({
    ...nullContainerDocumentWatermarks,
    containerIds,
    listContainerDocuments: async (containerId) => {
      listContainerDocumentsCalls.push(containerId);
      activeListContainerDocumentsCalls += 1;
      maxActiveListContainerDocumentsCalls = Math.max(
        maxActiveListContainerDocumentsCalls,
        activeListContainerDocumentsCalls,
      );

      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return listContainerDocumentsResponse([]);
      } finally {
        activeListContainerDocumentsCalls -= 1;
      }
    },
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
  });

  expect(new Set(listContainerDocumentsCalls)).toEqual(new Set(containerIds));
  expect(maxActiveListContainerDocumentsCalls).toBeGreaterThan(1);
  expect(maxActiveListContainerDocumentsCalls).toBeLessThanOrEqual(4);
});
