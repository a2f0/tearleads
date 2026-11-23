import { expect, test } from "bun:test";
import type {
  PendingWriteQueueItem,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { renderHook } from "@testing-library/react";
import {
  initialLaneReconnectState,
  transitionLaneReconnect,
} from "./laneReconnectMachine";
import { selectSyncHolds, summarizeSyncLanes } from "./syncActivityModel";
import { DESCRIBED, lane, NO_LANES, snapshot } from "./syncStatus.testFixtures";
import { describeSyncStatus, summarizePendingWrites } from "./syncStatusModel";
import { describeSyncStatusDetails } from "./syncStatusPopoverModel";
import { useStaleLaneFailures } from "./useStaleLaneFailures";

const OFFLINE_FAILURE: Partial<SyncLaneSnapshot> = {
  key: "documents:note",
  lastAction: "failed",
  lastError: "Failed to fetch",
  lastFailedAt: "2026-11-22T10:00:00.000Z",
  requested: true,
  status: "queued",
};

test("failures recorded while offline are left out after the reconnect, new ones are not", () => {
  const offline = initialLaneReconnectState(false);
  const before = snapshot([lane(OFFLINE_FAILURE)]);
  const online = transitionLaneReconnect(offline, {
    online: true,
    snapshot: before,
    type: "observed",
  });
  if (online.status !== "online") throw new Error("expected online");
  expect(summarizeSyncLanes(before, online.staleFailures)).toEqual(NO_LANES);
  // Staying online keeps the same state, so the hook does not re-render.
  expect(
    transitionLaneReconnect(online, {
      online: true,
      snapshot: before,
      type: "observed",
    }),
  ).toBe(online);

  // The retry after the reconnect fails again: that failure is today's.
  const failedAgain = snapshot([
    lane({
      ...OFFLINE_FAILURE,
      lastError: "Sync failed (500)",
      lastFailedAt: "2026-11-22T10:00:05.000Z",
    }),
  ]);
  expect(summarizeSyncLanes(failedAgain, online.staleFailures)).toEqual({
    failed: 1,
    firstError: "Sync failed (500)",
    running: 0,
  });

  // A run abandoned before the reconnect is the same run until it restarts.
  const abandoned: Partial<SyncLaneSnapshot> = {
    key: "documents:stuck",
    lastStartedAt: "2026-11-22T09:58:00.000Z",
    runAbandoned: true,
    running: true,
    status: "running",
  };
  const stuck = transitionLaneReconnect(offline, {
    online: true,
    snapshot: snapshot([lane(abandoned)]),
    type: "observed",
  });
  if (stuck.status !== "online") throw new Error("expected online");
  expect(
    summarizeSyncLanes(snapshot([lane(abandoned)]), stuck.staleFailures).failed,
  ).toBe(0);
  expect(
    summarizeSyncLanes(
      snapshot([
        lane({ ...abandoned, lastStartedAt: "2026-11-22T10:01:00.000Z" }),
      ]),
      stuck.staleFailures,
    ).failed,
  ).toBe(1);

  // Online from the start, nothing is blamed on being offline.
  const fresh = initialLaneReconnectState(true);
  if (fresh.status !== "online") throw new Error("expected online");
  expect(summarizeSyncLanes(before, fresh.staleFailures).failed).toBe(1);
  // Going offline forgets the old baseline; the next reconnect takes a new one.
  expect(
    transitionLaneReconnect(online, {
      online: false,
      snapshot: before,
      type: "observed",
    }).status,
  ).toBe("offline");
});

test("the first render back online already leaves the offline failures out", () => {
  const before = snapshot([lane(OFFLINE_FAILURE)]);
  const failedPerRender: number[] = [];
  const { rerender } = renderHook(
    ({ online }) => {
      const stale = useStaleLaneFailures(online, before);
      const lanes = summarizeSyncLanes(before, stale);
      // Offline hides failures anyway; what matters is every online render.
      if (online) failedPerRender.push(lanes.failed);
      return lanes;
    },
    { initialProps: { online: false } },
  );
  rerender({ online: true });
  rerender({ online: true });
  expect(failedPerRender.length).toBeGreaterThan(0);
  expect(failedPerRender.every((failed) => failed === 0)).toBe(true);
});

test("a run the watchdog abandoned is named in plain words", () => {
  expect(
    summarizeSyncLanes(
      snapshot([
        lane({
          key: "documents:stuck",
          lastError:
            "Sync lane watchdog: run exceeded 120000ms; continuing with other lanes",
          runAbandoned: true,
          running: true,
          status: "running",
        }),
      ]),
    ),
  ).toEqual({ failed: 1, firstError: "Stopped responding", running: 1 });
});

function queued(
  organizationId: string | null,
  status: PendingWriteQueueItem["status"] = "pending",
): PendingWriteQueueItem {
  return {
    containerId: null,
    createdAt: null,
    localId: `note-${organizationId}-${status}`,
    name: null,
    namespace: null,
    objectKind: "document",
    operations: [
      {
        byteLength: 0,
        count: 1,
        createdAt: null,
        kind: "update",
        lastAttemptedAt: null,
        lastError: null,
        status: status === "blocked" ? "blocked" : "pending",
        targetContainerId: null,
        updatedAt: null,
      },
    ],
    organizationId,
    remoteId: null,
    status,
    updatedAt: null,
  };
}

test("a pause is blamed for queued writes only when it holds one of them", () => {
  const summary = summarizePendingWrites([
    queued("org-a"),
    queued("org-a"),
    queued("org-b", "blocked"),
    queued(null),
  ]);
  expect(summary.organizationIds).toEqual(["org-a", "org-b"]);
  expect(summary.blockedCount).toBe(1);

  const holds = {
    dbReady: true,
    lanes: NO_LANES,
    online: true,
    writeOrganizationIds: ["org-a"],
  };
  expect(
    selectSyncHolds({ ...holds, pausedOrganizationIds: new Set(["org-c"]) }),
  ).toMatchObject({ pausedOrganizationCount: 1, writesPaused: false });
  expect(
    selectSyncHolds({ ...holds, pausedOrganizationIds: new Set(["org-a"]) }),
  ).toMatchObject({ pausedOrganizationCount: 1, writesPaused: true });

  const pending = {
    ...DESCRIBED,
    status: "pending",
    pendingWriteCount: 3,
    syncActive: true,
    syncPaused: true,
  } as const;
  // Another organization's pause holds none of these writes, so they still
  // send and the pause is not named as the reason they wait.
  expect(describeSyncStatus(pending)).toBe("Syncing 3 changes…");
  expect(describeSyncStatus({ ...pending, syncActive: false })).toBe(
    "3 changes not yet synced",
  );
  expect(describeSyncStatus({ ...pending, writesPaused: true })).toBe(
    "3 changes not yet synced (sync is paused for an organization)",
  );
  // A blocked write is waiting on something else, whatever sync runs.
  expect(describeSyncStatus({ ...pending, blockedWriteCount: 1 })).toBe(
    "3 changes not yet synced",
  );
  // With nothing queued, any pause is named: its content is not pulled.
  expect(
    describeSyncStatus({ ...DESCRIBED, status: "synced", syncPaused: true }),
  ).toBe("All changes synced (sync is paused for an organization)");
});

test("the popover lists paused organizations whatever the status line names", () => {
  const details = {
    downloads: { failed: 0, firstError: null, pending: 0, status: "read" },
    lanes: NO_LANES,
    pendingWriteCount: 3,
    uploadingFileCount: 0,
  } as const;
  expect(
    describeSyncStatusDetails({ ...details, pausedOrganizationCount: 2 }),
  ).toEqual([
    "Changes to upload: 3",
    "Downloads: none waiting",
    "Sync paused for 2 organizations",
  ]);
  expect(
    describeSyncStatusDetails({ ...details, pausedOrganizationCount: 1 }).at(
      -1,
    ),
  ).toBe("Sync paused for 1 organization");
  expect(
    describeSyncStatusDetails({ ...details, pausedOrganizationCount: 0 }),
  ).toEqual(["Changes to upload: 3", "Downloads: none waiting"]);
});
