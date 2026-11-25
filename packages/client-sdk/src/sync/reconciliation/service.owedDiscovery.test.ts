import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/data/waitFor";
import { createReconciliationService } from "./service";
import {
  createGate,
  createReconciliationTestHost,
  perContainerDiscovery,
} from "./service.testFixtures";

test("resuming owed discovery lists exactly the owed lanes once", async () => {
  const discovered: string[] = [];
  const service = createReconciliationService(
    createReconciliationTestHost({
      discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
        discovered.push(containerId);
        return [];
      }),
      listKnownContainerIds: () => ["settled", "owed-a", "owed-b"],
      listOwedDocumentDiscoveryContainerIds: async () => ["owed-a", "owed-b"],
    }),
  );
  try {
    service.start();
    service.resumeOwedDiscovery();
    await waitFor(() => discovered.length === 2, "Owed lanes were not listed");
    expect(discovered.toSorted()).toEqual(["owed-a", "owed-b"]);

    // A lane this session already reconciled is not listed again unforced.
    service.resumeOwedDiscovery();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discovered).toHaveLength(2);
  } finally {
    service.stop();
  }
});

test("a stopped reconciler drops an owed lookup that resolves late", async () => {
  const lookup = createGate();
  const discovered: string[] = [];
  const service = createReconciliationService(
    createReconciliationTestHost({
      discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
        discovered.push(containerId);
        return [];
      }),
      listOwedDocumentDiscoveryContainerIds: async () => {
        await lookup.wait;
        return ["owed"];
      },
    }),
  );
  service.start();
  service.resumeOwedDiscovery();
  service.stop();
  service.start();
  lookup.open();
  await new Promise((resolve) => setTimeout(resolve, 20));
  service.stop();
  expect(discovered).toEqual([]);
});

test("a failed owed lookup is reported, and an ignorable one is not", async () => {
  for (const ignorable of [false, true]) {
    const failure = new Error("database closed");
    const reports: unknown[] = [];
    const service = createReconciliationService(
      createReconciliationTestHost({
        isIgnorableError: (error) => ignorable && error === failure,
        listOwedDocumentDiscoveryContainerIds: () => Promise.reject(failure),
        logError: (message, error) => {
          reports.push([message, error]);
        },
      }),
    );
    try {
      service.start();
      service.resumeOwedDiscovery();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(reports).toEqual(
        ignorable
          ? []
          : [["Reconciliation: owed discovery lookup failed", failure]],
      );
    } finally {
      service.stop();
    }
  }
});
