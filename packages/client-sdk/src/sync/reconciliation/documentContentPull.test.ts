import { expect, test } from "bun:test";
import type { ContainerNode } from "../../stores/container-contents";
import { syncedContainerDocumentObjectSyncState } from "../../workflows/container-contents/syncState";
import { createReconciledDocumentContentPuller } from "./documentContentPull";

function container(input: {
  id: string;
  systemSlot?: string | null | undefined;
}): ContainerNode {
  return {
    id: input.id,
    kind: "container",
    metadataDocumentId: `${input.id}-metadata`,
    name: input.id,
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: input.systemSlot ?? null,
  };
}

function summary(input: { documentId: string; updatedAt: string }) {
  return {
    containerId: "summary-home",
    documentId: input.documentId,
    id: `local-${input.documentId}`,
    title: input.documentId,
    updatedAt: input.updatedAt,
  };
}

test("eagerly pulls each system document version once", () => {
  const containers = new Map([
    ["contacts", container({ id: "contacts", systemSlot: "sys_contacts" })],
  ]);
  const pulls: Array<{
    containerId: string;
    documentId: string;
    localId: string;
  }> = [];
  const registeredPulls: string[] = [];
  const pull = createReconciledDocumentContentPuller({
    getContainer: (containerId) => containers.get(containerId) ?? null,
    pullDocumentContent: (input) => pulls.push(input),
    requestRegisteredDocumentRemoteSync: (localId) => {
      registeredPulls.push(localId);
      return true;
    },
  });

  const firstVersion = summary({
    documentId: "contact-1",
    updatedAt: "2026-07-11T12:00:00.000Z",
  });
  pull("contacts", [firstVersion], false);
  pull("contacts", [firstVersion], true);
  pull(
    "contacts",
    [
      summary({
        documentId: "contact-1",
        updatedAt: "2026-07-11T12:00:01.000Z",
      }),
    ],
    false,
  );

  expect(pulls).toEqual([
    {
      containerId: "contacts",
      documentId: "contact-1",
      localId: "local-contact-1",
    },
    {
      containerId: "contacts",
      documentId: "contact-1",
      localId: "local-contact-1",
    },
  ]);
  expect(registeredPulls).toEqual(["local-contact-1"]);
});

test("retries a system document version after pull scheduling throws", () => {
  const document = summary({
    documentId: "contact-1",
    updatedAt: "2026-07-11T12:00:00.000Z",
  });
  let attempts = 0;
  const pull = createReconciledDocumentContentPuller({
    getContainer: () =>
      container({ id: "contacts", systemSlot: "sys_contacts" }),
    pullDocumentContent: () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("planned scheduling failure");
      }
    },
    requestRegisteredDocumentRemoteSync: () => true,
  });

  expect(() => pull("contacts", [document], false)).toThrow(
    "planned scheduling failure",
  );
  expect(() => pull("contacts", [document], false)).not.toThrow();
  expect(attempts).toBe(2);
});

test("forgets a superseded system document version", () => {
  const pulledVersions: string[] = [];
  const pull = createReconciledDocumentContentPuller({
    getContainer: () =>
      container({ id: "contacts", systemSlot: "sys_contacts" }),
    pullDocumentContent: () => {
      pulledVersions.push(currentVersion);
    },
    requestRegisteredDocumentRemoteSync: () => true,
  });
  let currentVersion = "2026-07-11T12:00:00.000Z";
  const reconcile = () => {
    pull(
      "contacts",
      [summary({ documentId: "contact-1", updatedAt: currentVersion })],
      false,
    );
  };

  reconcile();
  currentVersion = "2026-07-11T12:00:01.000Z";
  reconcile();
  currentVersion = "2026-07-11T12:00:00.000Z";
  reconcile();

  // Re-observing a superseded value schedules it again. That is the observable
  // proof that the cache retains one version per container/document instead of
  // every historical updatedAt value.
  expect(pulledVersions).toEqual([
    "2026-07-11T12:00:00.000Z",
    "2026-07-11T12:00:01.000Z",
    "2026-07-11T12:00:00.000Z",
  ]);
});

test("keeps ordinary document content lazy except on forced refresh", () => {
  const containers = new Map([["root", container({ id: "root" })]]);
  const eagerPulls: string[] = [];
  const registeredPulls: string[] = [];
  const pull = createReconciledDocumentContentPuller({
    getContainer: (containerId) => containers.get(containerId) ?? null,
    pullDocumentContent: ({ localId }) => eagerPulls.push(localId),
    requestRegisteredDocumentRemoteSync: (localId) => {
      registeredPulls.push(localId);
      return true;
    },
  });
  const document = summary({
    documentId: "note-1",
    updatedAt: "2026-07-11T12:00:00.000Z",
  });

  pull("root", [document], false);
  pull("root", [document], true);

  expect(eagerPulls).toEqual([]);
  expect(registeredPulls).toEqual(["local-note-1"]);
});
