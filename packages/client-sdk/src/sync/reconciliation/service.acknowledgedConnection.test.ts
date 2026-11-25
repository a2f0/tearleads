import { expect, test } from "bun:test";
import type { DocumentSummary } from "../../data/documents/documentSummary";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
  perContainerDiscovery,
  silenceExpectedTransientDiscoveryError,
} from "./service.testFixtures";
import type {
  ContainerDiscoveryOutcome,
  ReconciliationHost,
} from "./serviceTypes";

function summary(id: string, containerId: string): DocumentSummary {
  return {
    containerId,
    documentId: `remote-${id}`,
    id,
    title: id,
    updatedAt: "2026-11-25T00:00:00.000Z",
  } as DocumentSummary;
}

interface ContentPull {
  readonly containerId: string;
  readonly documentIds: ReadonlyArray<string>;
  readonly force: boolean;
}

/** A host that records what an acknowledged-connection sweep does. */
function createObservedHost(overrides: Partial<ReconciliationHost>) {
  const laneReports: Array<readonly [string, boolean]> = [];
  const pulls: ContentPull[] = [];
  const steps: string[] = [];
  const host = createReconciliationTestHost({
    listKnownContainerIds: () => ["a", "b"],
    loadContainerDelta: async (containerId) => ({
      containerId,
      documentSummaries: [summary(`${containerId}-note`, containerId)],
    }),
    reportDocumentLaneListed: (containerId, listed) => {
      laneReports.push([containerId, listed]);
    },
    requestDocumentContentPull: (containerId, documents, force) => {
      pulls.push({
        containerId,
        documentIds: documents.map((document) => document.id),
        force,
      });
    },
    requestOwedDocumentReads: async () => {
      steps.push("owed-reads");
    },
    ...overrides,
  });
  return { host, laneReports, pulls, steps };
}

test("an acknowledged connection lists every known lane and forces no document", async () => {
  const listed: string[] = [];
  const { host, laneReports, pulls, steps } = createObservedHost({
    discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
      listed.push(containerId);
      // Lane a moved; lane b lists nothing new.
      return containerId === "a" ? [summary("a-note", "a")] : null;
    }),
  });
  const service = createReconciliationService(host);
  service.start();
  // Both lanes were already reconciled this session.
  await service.reconcileNow();
  listed.length = 0;
  pulls.length = 0;
  laneReports.length = 0;
  steps.length = 0;

  await service.reconcileAcknowledgedConnection();

  expect(listed).toEqual(["a", "b"]);
  // The moved lane's documents are handed over unforced: a listed document
  // the cursor does not cover was owed its read by the listing itself.
  expect(pulls).toEqual([
    { containerId: "a", documentIds: ["a-note"], force: false },
  ]);
  expect(laneReports).toEqual([
    ["a", true],
    ["b", true],
  ]);
  expect(steps).toEqual(["owed-reads"]);
  service.stop();
});

test("a lane the catch-up cannot list has its registered documents probed", async () => {
  const restoreConsole = silenceExpectedTransientDiscoveryError(0);
  const { host, laneReports, pulls, steps } = createObservedHost({
    discoverContainerDocuments: async (requests, onOutcome) => {
      const outcomes = requests.map(
        ({ containerId }): ContainerDiscoveryOutcome =>
          containerId === "a"
            ? {
                containerId,
                reason: new Error("transient discovery failure"),
                status: "rejected",
              }
            : // The server refused the lane, or its organization is paused.
              { containerId, status: "fulfilled", unlisted: true, value: null },
      );
      for (const outcome of outcomes) await onOutcome(outcome);
      return outcomes;
    },
  });
  const service = createReconciliationService(host);

  await expect(service.reconcileAcknowledgedConnection()).rejects.toThrow(
    "transient discovery failure",
  );

  expect(laneReports).toEqual([
    ["a", false],
    ["b", false],
  ]);
  // Neither lane vouches for its documents, so each registered one probes.
  expect(pulls).toEqual([
    { containerId: "a", documentIds: ["a-note"], force: true },
    { containerId: "b", documentIds: ["b-note"], force: true },
  ]);
  // What other lanes owed is still asked for when one lane fails.
  expect(steps).toEqual(["owed-reads"]);
  restoreConsole();
});

test("an explicit refresh still forces every registered document", async () => {
  const { host, pulls } = createObservedHost({
    discoverContainerDocuments: perContainerDiscovery(async (containerId) => [
      summary(`${containerId}-note`, containerId),
    ]),
  });
  const service = createReconciliationService(host);

  await service.reconcileNow();

  expect(pulls.map(({ containerId, force }) => [containerId, force])).toEqual([
    ["a", true],
    ["b", true],
  ]);
});

test("the catch-up never joins a sweep that listed before the acknowledgement", async () => {
  const gate = createGate();
  const listed: string[] = [];
  const { host } = createObservedHost({
    discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
      listed.push(containerId);
      await gate.wait;
      return null;
    }),
  });
  const service = createReconciliationService(host);
  const refresh = service.reconcileNow();
  // The running sweep has already asked for its lanes.
  await Promise.resolve();
  await Promise.resolve();
  const catchUp = service.reconcileAcknowledgedConnection();
  gate.open();
  await Promise.all([refresh, catchUp]);

  // The explicit refresh listed each lane once, and the catch-up again.
  expect(listed.sort()).toEqual(["a", "a", "b", "b"]);
});
