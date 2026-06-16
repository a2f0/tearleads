import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import { takePendingReconciliationEvents } from "./useContainerContentsDeviceFirst";

function summary(input: {
  containerId: string;
  documentId: string | null;
}): DocumentSummary {
  return {
    containerId: input.containerId,
    documentId: input.documentId,
    id: `${input.containerId}:${input.documentId ?? "missing"}`,
    title: "Document",
    updatedAt: "2026-06-16T00:00:00.000Z",
  };
}

test("reconciliation events are processed once per known container", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["c-1"],
    id: "event-1",
    type: "document_update_created",
  };

  expect(
    takePendingReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1"],
      processedEventKeys,
    }),
  ).toEqual([event]);
  expect(
    takePendingReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1"],
      processedEventKeys,
    }),
  ).toEqual([]);
});

test("reconciliation events can become pending when containers become known", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["c-1", "c-2"],
    id: "event-1",
    type: "document_update_created",
  };

  expect(
    takePendingReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1"],
      processedEventKeys,
    }),
  ).toEqual([{ ...event, containerIds: ["c-1"] }]);
  expect(
    takePendingReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1", "c-2"],
      processedEventKeys,
    }),
  ).toEqual([{ ...event, containerIds: ["c-2"] }]);
});

test("reconciliation events skip documents already known in a container", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["c-1", "c-2"],
    documentId: "doc-1",
    id: "event-1",
    type: "document_update_created",
  };

  expect(
    takePendingReconciliationEvents({
      documentSummariesByContainerId: new Map([
        ["c-1", [summary({ containerId: "c-1", documentId: "doc-1" })]],
      ]),
      events: [event],
      knownContainerIds: ["c-1", "c-2"],
      processedEventKeys,
    }),
  ).toEqual([{ ...event, containerIds: ["c-2"] }]);
});

test("reconciliation events only inspect summaries for touched containers", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["c-1"],
    documentId: "doc-1",
    id: "event-1",
    type: "document_update_created",
  };
  const documentSummariesByContainerId = new Map([
    ["c-1", []],
    ["untouched", [summary({ containerId: "untouched", documentId: "doc-1" })]],
  ]);
  const requestedContainerIds: string[] = [];
  const get = documentSummariesByContainerId.get.bind(
    documentSummariesByContainerId,
  );
  documentSummariesByContainerId.get = (containerId: string) => {
    requestedContainerIds.push(containerId);
    return get(containerId);
  };

  expect(
    takePendingReconciliationEvents({
      documentSummariesByContainerId,
      events: [event],
      knownContainerIds: ["c-1"],
      processedEventKeys,
    }),
  ).toEqual([event]);
  expect(requestedContainerIds).toEqual(["c-1"]);
});
