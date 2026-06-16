import { expect, test } from "bun:test";
import { createDomainScope } from "../domainScope";
import {
  beginDomainSyncUploadLane,
  getDomainSyncCoordinatorSnapshot,
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
    label: "Upload report.pdf",
  });

  const started = findLane(domainScope, "blob-upload:slot-1");
  expect(started?.phase).toBe("blob");
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
