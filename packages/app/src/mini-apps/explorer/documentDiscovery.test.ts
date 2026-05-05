import { expect, test } from "bun:test";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/documents/shared/documentSummary";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
  hasUndiscoveredDocumentUpdateEvent,
} from "./documentDiscovery";

type CapturedDiscoveredDocumentInput = Omit<
  DiscoveredDocumentInput,
  "accessStateHash"
> & {
  accessStateHash: string;
};

function listContainerDocumentsResponse(
  items: ReadonlyArray<{
    createdAt: string;
    currentAccessEpoch: number;
    currentAccessStateHash: string;
    id: string;
    linkedContainerIds: string[];
    referencedPrincipals?: Array<{
      keyEpoch: number;
      principalId: string;
      principalType: "group" | "organization";
      stateHash: string;
      version: number;
    }>;
    updatedAt: string;
  }>,
) {
  const lastItem = items.at(-1);
  return {
    hasMore: false,
    items: [...items],
    nextWatermark: lastItem
      ? { id: lastItem.id, updatedAt: lastItem.updatedAt }
      : null,
    tombstones: [],
  };
}

function captureDiscoveredDocumentInputs(
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): CapturedDiscoveredDocumentInput[] {
  return inputs.map((input) => {
    if (
      typeof input.accessStateHash !== "string" ||
      input.accessStateHash.length === 0
    ) {
      throw new Error("Expected discovered document input to include a hash.");
    }

    return {
      ...input,
      accessStateHash: input.accessStateHash,
    };
  });
}

test("unknown document update events trigger rediscovery for shared container notes", async () => {
  const cachedPrincipalReferences: Array<
    ReadonlyArray<{
      keyEpoch: number;
      principalId: string;
      principalType: "group" | "organization";
      stateHash: string;
      version: number;
    }>
  > = [];
  const replaceDocumentLinksBatchCalls: Array<
    ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>
  > = [];
  const upsertDiscoveredDocumentsCalls: Array<
    ReadonlyArray<CapturedDiscoveredDocumentInput>
  > = [];
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
      const capturedInputs = captureDiscoveredDocumentInputs(inputs);
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

test("manual refresh can discover documents across all visible containers", async () => {
  const cachedPrincipalReferences: Array<
    ReadonlyArray<{
      keyEpoch: number;
      principalId: string;
      principalType: "group" | "organization";
      stateHash: string;
      version: number;
    }>
  > = [];
  const listContainerDocumentsCalls: string[] = [];
  const replaceDocumentLinksBatchCalls: Array<
    ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>
  > = [];
  const upsertDiscoveredDocumentsCalls: Array<
    ReadonlyArray<CapturedDiscoveredDocumentInput>
  > = [];
  const discovered = await discoverAllContainerDocuments({
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
      replaceDocumentLinksBatchCalls.push(inputs);
    },
    upsertDiscoveredDocuments: async (inputs) => {
      const capturedInputs = captureDiscoveredDocumentInputs(inputs);
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
        linkedContainerIds: ["container-a"],
      },
      {
        accessEpoch: 2,
        accessStateHash: "access-state-hash-b",
        containerId: "container-b",
        createdAt: "2026-04-06T12:05:00.000Z",
        documentId: "document-b",
        linkedContainerIds: ["container-b"],
      },
    ],
  ]);
  expect(cachedPrincipalReferences).toEqual([
    [
      {
        keyEpoch: 1,
        principalId: "group-a",
        principalType: "group",
        stateHash: "state-hash-a",
        version: 1,
      },
      {
        keyEpoch: 2,
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
