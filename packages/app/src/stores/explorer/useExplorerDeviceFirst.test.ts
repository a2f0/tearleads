import { expect, test } from "bun:test";
import { takePendingExplorerReconciliationEvents } from "./useExplorerDeviceFirst";

test("explorer reconciliation events are processed once per known container", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["c-1"],
    id: "event-1",
    type: "document_update_created",
  };

  expect(
    takePendingExplorerReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1"],
      processedEventKeys,
    }),
  ).toEqual([event]);
  expect(
    takePendingExplorerReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1"],
      processedEventKeys,
    }),
  ).toEqual([]);
});

test("explorer reconciliation events can become pending when containers become known", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["c-1", "c-2"],
    id: "event-1",
    type: "document_update_created",
  };

  expect(
    takePendingExplorerReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1"],
      processedEventKeys,
    }),
  ).toEqual([{ ...event, containerIds: ["c-1"] }]);
  expect(
    takePendingExplorerReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1", "c-2"],
      processedEventKeys,
    }),
  ).toEqual([{ ...event, containerIds: ["c-2"] }]);
});

test("explorer reconciliation events skip documents already known in a container", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["c-1", "c-2"],
    documentId: "doc-1",
    id: "event-1",
    type: "document_update_created",
  };

  expect(
    takePendingExplorerReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1", "c-2"],
      knownDocumentIdsByContainerId: new Map([["c-1", new Set(["doc-1"])]]),
      processedEventKeys,
    }),
  ).toEqual([{ ...event, containerIds: ["c-2"] }]);
});
