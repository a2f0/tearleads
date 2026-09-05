import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import {
  createInitialDocumentProbe,
  type InitialDocumentProbeBatchInput,
} from "./initialDocumentProbe";
import { createReconciliationService } from "./service";
import { createReconciliationTestHost } from "./service.testFixtures";

test("reconciliation reuses a full discovery listing and still fetches incremental lanes for the initial probe", async () => {
  const fullReads: string[] = [];
  const batches: InitialDocumentProbeBatchInput[] = [];
  let completed = false;
  const service = createReconciliationService(
    createReconciliationTestHost({
      listKnownContainerIds: () => ["full", "incremental"],
      discoverContainerDocuments: async (id, onFullListing) => {
        if (id === "full") onFullListing?.(["visible-a"]);
        return [];
      },
      listContainerDocumentIds: async (id) => {
        fullReads.push(id);
        return ["visible-b"];
      },
      probeUndiscoveredDocumentsBatch: async (batch) => {
        batches.push(batch);
        return { done: true, nextCursor: null, requestedCount: 1 };
      },
      reportInitialDocumentProbeComplete: () => {
        completed = true;
      },
    }),
  );
  try {
    service.start();
    service.enqueueIdleBackfill();
    await waitFor(() => completed, "Expected initial recovery probe");
    expect(fullReads).toEqual(["incremental"]);
    expect(batches).toHaveLength(1);
    expect([...(batches[0]?.listedContainerIds ?? [])]).toEqual([
      "full",
      "incremental",
    ]);
    expect([...(batches[0]?.listedDocumentIds ?? [])]).toEqual([
      "visible-a",
      "visible-b",
    ]);
  } finally {
    service.stop();
  }
});

for (const reset of ["stop", "eligible-set"] as const) {
  test(`a discovery listing from before ${reset} cannot suppress a fresh recovery read`, async () => {
    const reads: string[] = [];
    const batches: InitialDocumentProbeBatchInput[] = [];
    const probe = createInitialDocumentProbe({
      listContainerDocumentIds: async (id) => {
        reads.push(id);
        return ["current"];
      },
      probeUndiscoveredDocumentsBatch: async (batch) => {
        batches.push(batch);
        return { done: true, nextCursor: null, requestedCount: 0 };
      },
      reportInitialDocumentProbeComplete: () => {},
    });
    probe.arm(["container"]);
    const staleListing = probe.captureListing("container");
    if (reset === "stop") probe.resetPending();
    else probe.arm(["container", "other"]);
    probe.arm(["container"]);
    staleListing(["stale"]);
    while (probe.canRun()) await probe.run();
    expect(reads).toEqual(["container"]);
    expect([...(batches[0]?.listedDocumentIds ?? [])]).toEqual(["current"]);
  });
}
