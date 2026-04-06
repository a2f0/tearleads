import { expect, test } from "bun:test";
import type { NoteSummary } from "../notes/notesPersistence";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
  hasUndiscoveredDocumentUpdateEvent,
} from "./documentDiscovery";

test("unknown document update events trigger rediscovery for shared container notes", async () => {
  const replaceDocumentLinksBatchCalls: Array<
    ReadonlyArray<{
      containerIds: ReadonlyArray<string>;
      documentId: string;
    }>
  > = [];
  const upsertDiscoveredNotesCalls: Array<
    ReadonlyArray<{
      accessEpoch: number;
      containerId: string;
      createdAt: string;
      documentId: string;
    }>
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
    containerId: "shared-container",
    listContainerDocuments: async () => [
      {
        createdAt: "2026-04-06T12:00:00.000Z",
        currentAccessEpoch: 1,
        id: "peer-note-document",
        linkedContainerIds: ["shared-container"],
      },
    ],
    replaceDocumentLinksBatch: async (inputs) => {
      replaceDocumentLinksBatchCalls.push(inputs);
    },
    upsertDiscoveredNotes: async (inputs) => {
      upsertDiscoveredNotesCalls.push(inputs);
      const summaries: NoteSummary[] = inputs.map((input) => ({
        id: `note-${input.documentId}`,
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
  expect(upsertDiscoveredNotesCalls).toEqual([
    [
      {
        accessEpoch: 1,
        containerId: "shared-container",
        createdAt: "2026-04-06T12:00:00.000Z",
        documentId: "peer-note-document",
      },
    ],
  ]);
  expect(discovered).toEqual([
    {
      id: "note-peer-note-document",
      containerId: "shared-container",
      documentId: "peer-note-document",
      title: "Peer shared note",
      updatedAt: "2026-04-06T12:00:00.000Z",
    },
  ]);
});

test("manual refresh can discover documents across all visible containers", async () => {
  const listContainerDocumentsCalls: string[] = [];
  const discovered = await discoverAllContainerDocuments({
    containerIds: ["container-a", "container-b", "container-a"],
    listContainerDocuments: async (containerId) => {
      listContainerDocumentsCalls.push(containerId);
      if (containerId === "container-a") {
        return [
          {
            createdAt: "2026-04-06T12:00:00.000Z",
            currentAccessEpoch: 1,
            id: "document-a",
            linkedContainerIds: ["container-a"],
          },
        ];
      }

      return [
        {
          createdAt: "2026-04-06T12:05:00.000Z",
          currentAccessEpoch: 2,
          id: "document-b",
          linkedContainerIds: ["container-b"],
        },
      ];
    },
    replaceDocumentLinksBatch: async () => {},
    upsertDiscoveredNotes: async (inputs) =>
      inputs.map<NoteSummary>((input) => ({
        id: `note-${input.documentId}`,
        containerId: input.containerId,
        documentId: input.documentId,
        title: input.documentId,
        updatedAt: input.createdAt,
      })),
  });

  expect(listContainerDocumentsCalls).toEqual(["container-a", "container-b"]);
  expect(discovered).toEqual([
    {
      id: "note-document-a",
      containerId: "container-a",
      documentId: "document-a",
      title: "document-a",
      updatedAt: "2026-04-06T12:00:00.000Z",
    },
    {
      id: "note-document-b",
      containerId: "container-b",
      documentId: "document-b",
      title: "document-b",
      updatedAt: "2026-04-06T12:05:00.000Z",
    },
  ]);
});
