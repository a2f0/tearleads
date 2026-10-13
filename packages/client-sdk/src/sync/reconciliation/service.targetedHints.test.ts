import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { getOrCreateDomainSyncCoordinator } from "../../data/sync/syncCoordinator";
import { createReconciledDocumentContentPuller } from "./documentContentPull";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
} from "./service.testFixtures";
import { enqueueReconciliationForEvents } from "./triggers";

const documents = Array.from({ length: 100 }, (_, index) => ({
  containerId: "root",
  documentId: `doc-${index}`,
  id: `local-${index}`,
  title: "file",
  updatedAt: "2026-10-13T00:00:00Z",
}));

test("a hint burst during discovery coalesces one trailing listing and never probes sibling documents", async () => {
  const started = createGate();
  const finish = createGate();
  let listings = 0;
  const probes: string[] = [];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async () => {
      listings += 1;
      if (listings === 1) {
        started.open();
        await finish.wait;
      }
      return documents;
    },
    listKnownContainerIds: () => ["root"],
    loadContainerDelta: async (containerId) => ({
      containerId,
      documentSummaries: documents,
    }),
    requestDocumentContentPull: createReconciledDocumentContentPuller({
      getContainer: () => null,
      pullDocumentContent: () => {
        throw new Error("ordinary documents stay lazy");
      },
      requestRegisteredDocumentRemoteSync: (_localId, documentId) => {
        probes.push(documentId);
      },
    }),
  });
  const service = createReconciliationService(host);
  service.start();
  const hint = (documentId: string) =>
    enqueueReconciliationForEvents({
      events: [
        { type: "document_update_created", containerIds: ["root"], documentId },
      ],
      knownContainerIds: ["root"],
      service,
    });
  try {
    hint("doc-98");
    await started.wait;
    for (let index = 0; index < 50; index += 1) hint("doc-99");
  } finally {
    finish.open();
  }
  expect(
    await getOrCreateDomainSyncCoordinator(host.domainScope).waitForIdle(),
  ).toBe(true);
  expect(listings).toBe(2);
  expect(new Set(probes)).toEqual(new Set(["doc-98", "doc-99"]));
  expect(probes.length).toBeLessThanOrEqual(3);
  // Explicit Refresh still validates all registered content.
  probes.length = 0;
  await service.reconcileNow();
  expect(probes).toHaveLength(100);
  service.stop();
});

test("a failed targeted listing retries only its named document", async () => {
  const probes: string[] = [];
  let attempts = 0;
  const host = createReconciliationTestHost({
    discoverContainerDocuments: async () => {
      attempts += 1;
      return attempts === 1 ? null : documents;
    },
    loadContainerDelta: async (containerId) => ({
      containerId,
      documentSummaries: documents,
    }),
    requestDocumentContentPull: createReconciledDocumentContentPuller({
      getContainer: () => null,
      pullDocumentContent: () => {},
      requestRegisteredDocumentRemoteSync: (_localId, documentId) => {
        probes.push(documentId);
      },
    }),
  });
  const service = createReconciliationService(host);
  service.start();
  service.enqueueContainer("root", "active", true, "doc-99");
  await waitFor(() => attempts === 1, "expected incomplete listing");
  service.setActiveContainer("root");
  expect(
    await getOrCreateDomainSyncCoordinator(host.domainScope).waitForIdle(),
  ).toBe(true);
  expect(probes).toEqual(["doc-99"]);
  service.stop();
});

for (const targetedFirst of [true, false]) {
  test(`full revalidation dominates pending targets (targeted first: ${targetedFirst})`, async () => {
    const probes: string[] = [];
    const host = createReconciliationTestHost({
      discoverContainerDocuments: async () => documents,
      loadContainerDelta: async (containerId) => ({
        containerId,
        documentSummaries: documents,
      }),
      requestDocumentContentPull: createReconciledDocumentContentPuller({
        getContainer: () => null,
        pullDocumentContent: () => {},
        requestRegisteredDocumentRemoteSync: (_localId, documentId) => {
          probes.push(documentId);
        },
      }),
    });
    const service = createReconciliationService(host);
    service.start();
    try {
      for (const target of targetedFirst
        ? ["doc-99", undefined]
        : [undefined, "doc-99"]) {
        service.enqueueContainer("root", "active", true, target);
      }
      expect(
        await getOrCreateDomainSyncCoordinator(host.domainScope).waitForIdle(),
      ).toBe(true);
      expect(new Set(probes)).toEqual(
        new Set(documents.map(({ documentId }) => documentId)),
      );
    } finally {
      service.stop();
    }
  });
}
