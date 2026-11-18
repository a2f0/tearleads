import { expect, test } from "bun:test";
import type {
  ReferencedPrincipalStateResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../../data/documents/documentSummary";
import {
  discoverContainerDocuments,
  laneLister,
  nullContainerDocumentWatermarks,
  trustedContainerDocumentTombstones,
} from "./documentDiscovery.testUtils";
import type { DocumentLinkInput } from "./documentDiscoveryTypes";

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

test("document discovery loads shared container notes", async () => {
  const cachedPrincipalReferences: Array<
    ReadonlyArray<ReferencedPrincipalStateResponse>
  > = [];
  const replaceDocumentLinksBatchCalls: Array<
    ReadonlyArray<DocumentLinkInput>
  > = [];
  const upsertDiscoveredDocumentsCalls: Array<ReadonlyArray<CapturedInput>> =
    [];
  const discovered = await discoverContainerDocuments({
    ...nullContainerDocumentWatermarks,
    cacheReferencedPrincipalPolicies: async (references) => {
      cachedPrincipalReferences.push(references);
    },
    containerId: "shared-container",
    listContainerDocumentLanes: laneLister(async () =>
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
    ),
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
        accessEpoch: 1,
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
    ...trustedContainerDocumentTombstones,
    applyContainerDocumentTombstones: async () => [],
    containerId: "shared-container",
    loadContainerDocumentWatermark: async () => ({
      id: "old-document",
      updatedAt: "2026-04-06T11:00:00.000Z",
    }),
    listContainerDocumentLanes: laneLister(async (containerId, options) => {
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
    }),
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

test("container document discovery does not advance watermark when local apply fails", async () => {
  const saveContainerDocumentWatermarkCalls: SyncWatermark[] = [];

  await expect(
    discoverContainerDocuments({
      ...trustedContainerDocumentTombstones,
      applyContainerDocumentTombstones: async () => [],
      containerId: "shared-container",
      loadContainerDocumentWatermark: async () => null,
      listContainerDocumentLanes: laneLister(async () =>
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
      ),
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
      accessEpoch?: number | undefined;
      containerId: string;
      documentId: string;
      linkedContainerIds?: ReadonlyArray<string> | undefined;
      updatedAt: string;
    }>
  > = [];
  const saveContainerDocumentWatermarkCalls: SyncWatermark[] = [];

  const discovered = await discoverContainerDocuments({
    ...trustedContainerDocumentTombstones,
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
    listContainerDocumentLanes: laneLister(async () =>
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
    ),
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

  expect(applyOrder).toEqual(["apply-tombstones", "save-watermark"]);
  expect(appliedTombstones).toEqual([
    [
      {
        containerId: "shared-container",
        accessEpoch: Number.MAX_SAFE_INTEGER,
        documentId: "deleted-document",
        linkedContainerIds: [],
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
      ...trustedContainerDocumentTombstones,
      applyContainerDocumentTombstones: async () => {
        throw new Error("tombstone apply failed");
      },
      containerId: "shared-container",
      loadContainerDocumentWatermark: async () => null,
      listContainerDocumentLanes: laneLister(async () =>
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
      ),
      replaceDocumentLinksBatch: async () => {},
      saveContainerDocumentWatermark: async (_containerId, watermark) => {
        saveContainerDocumentWatermarkCalls.push(watermark);
      },
      upsertDiscoveredDocuments: async () => [],
    }),
  ).rejects.toThrow("tombstone apply failed");

  expect(saveContainerDocumentWatermarkCalls).toEqual([]);
});

test("discovery caches each referenced principal state once per listing", async () => {
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

  await discoverContainerDocuments({
    ...nullContainerDocumentWatermarks,
    cacheReferencedPrincipalPolicies: async (references) => {
      cachedPrincipalReferences.push(references);
    },
    containerId: "shared-container",
    listContainerDocumentLanes: laneLister(async () =>
      listContainerDocumentsResponse(
        ["document-a", "document-b"].map((id) => ({
          createdAt: "2026-04-06T12:00:00.000Z",
          currentAccessEpoch: 1,
          currentAccessStateHash: `access-state-hash-${id}`,
          id,
          linkedContainerIds: ["shared-container"],
          referencedPrincipals: [referencedPrincipal],
          updatedAt: "2026-04-06T12:00:00.000Z",
        })),
      ),
    ),
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredDocuments: async () => [],
  });

  expect(cachedPrincipalReferences).toEqual([[referencedPrincipal]]);
});
