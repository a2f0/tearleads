import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../shared/domainScope";
import {
  beginDomainSyncUploadLane,
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  hasDomainSyncCoordinatorPendingWork,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";
import type { SyncLaneProgress } from "./syncTelemetry";

function findLane(
  domainScope: ReturnType<typeof createDomainScope>,
  key: string,
) {
  return getDomainSyncCoordinatorSnapshot(domainScope).lanes.find(
    (lane) => lane.key === key,
  );
}

test("upload lanes report running, progress, and completion", () => {
  const domainScope = createDomainScope();
  const progress: SyncLaneProgress = {
    bytesTotal: 100,
    bytesUploaded: 40,
    partsCompleted: 2,
    partsTotal: 5,
  };

  const lane = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-1", {
    blobStorageKey: "blobs/report.pdf",
    label: "Upload report.pdf",
  });

  const started = findLane(domainScope, "blob-upload:slot-1");
  expect(started?.phase).toBe("blob");
  expect(started?.blobStorageKey).toBe("blobs/report.pdf");
  expect(started?.label).toBe("Upload report.pdf");
  expect(started?.status).toBe("running");
  expect(started?.progress).toBeNull();

  lane.reportProgress(progress);
  expect(findLane(domainScope, "blob-upload:slot-1")?.progress).toEqual(
    progress,
  );

  lane.complete();
  const completed = findLane(domainScope, "blob-upload:slot-1");
  expect(completed?.status).toBe("complete");
  // Completion snaps progress to the full payload regardless of last report.
  expect(completed?.progress).toEqual({
    bytesTotal: 100,
    bytesUploaded: 100,
    partsCompleted: 5,
    partsTotal: 5,
  });
});

test("failed upload lanes surface the error", () => {
  const domainScope = createDomainScope();
  const lane = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-2");

  lane.fail(new Error("part rejected"));

  const failed = findLane(domainScope, "blob-upload:slot-2");
  expect(failed?.status).toBe("error");
  expect(failed?.lastError).toBe("part rejected");
  expect(failed?.errorCount).toBe(1);
});

test("failed upload lanes include nested causes", () => {
  const domainScope = createDomainScope();
  const lane = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-2b");
  const error = new Error("Attachment upload failed for archive.zip.");
  Reflect.set(error, "cause", new Error("Multipart part 2 rejected"));

  lane.fail(error);

  expect(findLane(domainScope, "blob-upload:slot-2b")?.lastError).toBe(
    "Attachment upload failed for archive.zip. Caused by: Multipart part 2 rejected",
  );
});

test("upload lanes are ignored by the coordinator pump", async () => {
  const domainScope = createDomainScope();
  const lane = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-3");

  // An observational upload lane is never `requested`, so it is not pending
  // pump work even while running, and waitForIdle settles immediately.
  expect(hasDomainSyncCoordinatorPendingWork(domainScope)).toBe(true);
  lane.complete();
  expect(hasDomainSyncCoordinatorPendingWork(domainScope)).toBe(false);
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      timeoutMs: 50,
    }),
  ).toBe(true);
});

test("a stale upload lane handle cannot clobber a newer session", () => {
  const domainScope = createDomainScope();
  const stale = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-r");
  // Re-begin the same lane key (e.g. a retried upload) — this advances the
  // session and the stale handle's calls should become no-ops.
  const current = beginDomainSyncUploadLane(domainScope, "blob-upload:slot-r");

  stale.complete();
  expect(findLane(domainScope, "blob-upload:slot-r")?.status).toBe("running");

  current.complete();
  expect(findLane(domainScope, "blob-upload:slot-r")?.status).toBe("complete");
});

test("completed upload lanes are capped to the retention limit", () => {
  const domainScope = createDomainScope();

  for (let index = 0; index < 14; index += 1) {
    beginDomainSyncUploadLane(
      domainScope,
      `blob-upload:slot-${index}`,
    ).complete();
  }

  const uploadLanes = getDomainSyncCoordinatorSnapshot(
    domainScope,
  ).lanes.filter((lane) => lane.phase === "blob");
  expect(uploadLanes).toHaveLength(10);
  // The oldest lanes are evicted; the most recent survive.
  expect(uploadLanes.some((lane) => lane.key === "blob-upload:slot-0")).toBe(
    false,
  );
  expect(uploadLanes.some((lane) => lane.key === "blob-upload:slot-13")).toBe(
    true,
  );
});

test("an upload session does not hold back a pump lane registered on its key", async () => {
  const domainScope = createDomainScope();
  const upload = beginDomainSyncUploadLane(domainScope, "shared-key");
  let runs = 0;
  getOrCreateDomainSyncCoordinator(domainScope)
    .registerLane("shared-key", {
      run: async () => {
        runs += 1;
      },
    })
    .requestSync();

  expect(await waitForDomainSyncCoordinatorToSettle(domainScope)).toBe(true);
  expect(runs).toBe(1);
  upload.complete();
  expect(findLane(domainScope, "shared-key")?.status).toBe("complete");
});

test("an upload on a key whose pump run was abandoned still reports running", async () => {
  const domainScope = createDomainScope();
  let release: () => void = () => {};
  const hung = new Promise<void>((resolve) => {
    release = resolve;
  });
  getOrCreateDomainSyncCoordinator(domainScope)
    .registerLane("shared-key", { run: () => hung, watchdogMs: 5 })
    .requestSync();
  await waitFor(
    () => findLane(domainScope, "shared-key")?.runAbandoned === true,
    "watchdog did not abandon the run",
  );

  const upload = beginDomainSyncUploadLane(domainScope, "shared-key");
  expect(findLane(domainScope, "shared-key")?.running).toBe(true);
  expect(hasDomainSyncCoordinatorPendingWork(domainScope)).toBe(true);
  upload.complete();
  expect(findLane(domainScope, "shared-key")?.running).toBe(false);
  release();
});

async function expectDocumentLaneRuns(
  domainScope: ReturnType<typeof createDomainScope>,
): Promise<void> {
  let documentRuns = 0;
  getOrCreateDomainSyncCoordinator(domainScope)
    .registerLane("document", {
      run: async () => {
        documentRuns += 1;
      },
    })
    .requestSync();
  await waitFor(() => documentRuns === 1, "document lane did not run");
}

test("an upload on a structural lane's key does not hold the phase barrier", async () => {
  const domainScope = createDomainScope();
  const upload = beginDomainSyncUploadLane(domainScope, "shared-key");
  getOrCreateDomainSyncCoordinator(domainScope).registerLane("shared-key", {
    phase: "structural",
    run: async () => undefined,
  });

  await expectDocumentLaneRuns(domainScope);
  upload.complete();
});

test("an upload outliving the pump run on its structural key does not hold the barrier", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  coordinator.registerLane("shared-key", { run: () => blocked }).requestSync();
  await waitFor(
    () => findLane(domainScope, "shared-key")?.running === true,
    "pump run did not start",
  );
  const upload = beginDomainSyncUploadLane(domainScope, "shared-key");
  coordinator.registerLane("shared-key", {
    phase: "structural",
    run: async () => undefined,
  });
  release();
  await waitFor(
    () => findLane(domainScope, "shared-key")?.lastAction === "completed",
    "pump run did not settle",
  );

  await expectDocumentLaneRuns(domainScope);
  upload.complete();
});
