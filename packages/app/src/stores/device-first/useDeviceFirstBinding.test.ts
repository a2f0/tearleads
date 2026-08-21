import { expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import {
  buildReconciliationContainerRouting,
  buildReconciliationContainerRoutingKey,
  takePendingReconciliationEvents,
} from "./useDeviceFirstBinding";

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

function containerNode(input: {
  access?: ContainerNode["effectiveAccessLevel"];
  id: string;
  metadataDocumentId?: string | null;
  name?: string;
  organizationId: string;
  systemSlot?: string | null;
}): ContainerNode {
  return {
    effectiveAccessLevel: input.access,
    id: input.id,
    kind: "container",
    ...(input.metadataDocumentId === undefined
      ? {}
      : { metadataDocumentId: input.metadataDocumentId }),
    name: input.name ?? input.id,
    organizationId: input.organizationId,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: input.systemSlot ?? null,
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

test("reconciliation events skip documents already linked to the container", () => {
  // Self-echo of this client's own upload: the document is already linked to the
  // container in the reverse index, but the container summary's documentId has
  // not caught up yet, so only the link check can suppress it. Without this the
  // reconciliation lane cycles once per uploaded file.
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["c-1"],
    documentId: "doc-1",
    id: "event-1",
    type: "document_update_created",
  };

  expect(
    takePendingReconciliationEvents({
      documentSummariesByContainerId: new Map([["c-1", []]]),
      events: [event],
      knownContainerIds: ["c-1"],
      linkedContainerIdsByDocumentId: new Map([["doc-1", ["c-1"]]]),
      processedEventKeys,
    }),
  ).toEqual([]);
  // Suppressed without consuming a processed key, so the same id stays skippable.
  expect(processedEventKeys.size).toBe(0);
});

test("reconciliation events keep already-linked updates for forced containers", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["foreign-system", "regular"],
    documentId: "profile-doc",
    id: "event-1",
    type: "document_update_created",
  };

  expect(
    takePendingReconciliationEvents({
      events: [event],
      forceKnownDocumentContainerIds: new Set(["foreign-system"]),
      knownContainerIds: ["foreign-system", "regular"],
      linkedContainerIdsByDocumentId: new Map([
        ["profile-doc", ["foreign-system", "regular"]],
      ]),
      processedEventKeys,
    }),
  ).toEqual([{ ...event, containerIds: ["foreign-system"] }]);
});

test("reconciliation events still process a known document linked into a new container", () => {
  // doc-1 is known and linked to c-1, but the event links it into c-2 — that is
  // genuine new data for c-2 and must not be suppressed by the link check.
  const processedEventKeys = new Set<string>();
  const event = {
    containerIds: ["c-1", "c-2"],
    documentId: "doc-1",
    id: "event-1",
    type: "document_update_created",
  };

  expect(
    takePendingReconciliationEvents({
      events: [event],
      knownContainerIds: ["c-1", "c-2"],
      linkedContainerIdsByDocumentId: new Map([["doc-1", ["c-1"]]]),
      processedEventKeys,
    }),
  ).toEqual([{ ...event, containerIds: ["c-2"] }]);
});

test("document mutation events reconcile known documents in both containers", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    type: "document_mutation_created",
    containerIds: ["root", "trash"],
    documentId: "doc-1",
    eventType: "document.unlink",
    id: "event-1",
  };

  expect(
    takePendingReconciliationEvents({
      documentSummariesByContainerId: new Map([
        ["root", [summary({ containerId: "root", documentId: "doc-1" })]],
        ["trash", [summary({ containerId: "trash", documentId: "doc-1" })]],
      ]),
      events: [event],
      knownContainerIds: ["root", "trash"],
      linkedContainerIdsByDocumentId: new Map([["doc-1", ["root", "trash"]]]),
      processedEventKeys,
    }),
  ).toEqual([event]);
  expect(processedEventKeys).toEqual(
    new Set(["event-1:root", "event-1:trash"]),
  );
});

test("document purge events reconcile known documents in every prior container", () => {
  const processedEventKeys = new Set<string>();
  const event = {
    type: "document_mutation_created",
    containerIds: ["root", "archive"],
    documentId: "doc-1",
    eventType: "document.purge",
    id: "purge-event",
  };

  expect(
    takePendingReconciliationEvents({
      documentSummariesByContainerId: new Map([
        ["root", [summary({ containerId: "root", documentId: "doc-1" })]],
        ["archive", [summary({ containerId: "archive", documentId: "doc-1" })]],
      ]),
      events: [event],
      knownContainerIds: ["root", "archive"],
      linkedContainerIdsByDocumentId: new Map([["doc-1", ["root", "archive"]]]),
      processedEventKeys,
    }),
  ).toEqual([event]);
  expect(processedEventKeys).toEqual(
    new Set(["purge-event:root", "purge-event:archive"]),
  );
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

test("reconciliation routing includes remote-backed own and readable foreign system containers", () => {
  const routing = buildReconciliationContainerRouting({
    containers: [
      containerNode({
        id: "regular",
        metadataDocumentId: "regular-metadata",
        organizationId: "org-home",
      }),
      containerNode({
        id: "local-regular",
        organizationId: "org-home",
      }),
      containerNode({
        access: "read",
        id: "foreign-metadata",
        organizationId: "org-foreign",
        systemSlot: "sys_v1_foreign_metadata",
      }),
      containerNode({
        access: "read",
        id: "own-remote-system",
        metadataDocumentId: "own-system-metadata",
        organizationId: "org-home",
        systemSlot: "sys_v1_own_metadata",
      }),
      containerNode({
        access: "read",
        id: "own-local-system",
        organizationId: "org-home",
        systemSlot: "sys_v1_own_local",
      }),
      containerNode({
        access: "write",
        id: "write-shared-system",
        metadataDocumentId: "write-shared-system-metadata",
        organizationId: "org-foreign",
        systemSlot: "sys_v1_write_shared",
      }),
    ],
    homeOrganizationId: "org-home",
  });

  expect(routing.knownContainerIds).toEqual([
    "regular",
    "local-regular",
    "foreign-metadata",
    "own-remote-system",
  ]);
  expect([...routing.forceKnownDocumentContainerIds]).toEqual([
    "foreign-metadata",
  ]);
});

test("reconciliation routing key ignores non-routing container churn", () => {
  const first = buildReconciliationContainerRoutingKey({
    containers: [
      containerNode({
        access: "read",
        id: "foreign-metadata",
        name: "Before",
        organizationId: "org-foreign",
        systemSlot: "sys_v1_foreign_metadata",
      }),
    ],
    homeOrganizationId: "org-home",
  });
  const second = buildReconciliationContainerRoutingKey({
    containers: [
      containerNode({
        access: "read",
        id: "foreign-metadata",
        name: "After",
        organizationId: "org-foreign",
        systemSlot: "sys_v1_foreign_metadata",
      }),
    ],
    homeOrganizationId: "org-home",
  });

  expect(second).toBe(first);
});

test("reconciliation routing key changes when an own system container becomes remote-backed", () => {
  const localOnly = buildReconciliationContainerRoutingKey({
    containers: [
      containerNode({
        id: "own-system",
        organizationId: "org-home",
        systemSlot: "sys_v1_own_system",
      }),
    ],
    homeOrganizationId: "org-home",
  });
  const remoteBacked = buildReconciliationContainerRoutingKey({
    containers: [
      containerNode({
        id: "own-system",
        metadataDocumentId: "own-system-metadata",
        organizationId: "org-home",
        systemSlot: "sys_v1_own_system",
      }),
    ],
    homeOrganizationId: "org-home",
  });

  expect(localOnly).toBe("");
  expect(remoteBacked).toBe("0:own-system");
});
