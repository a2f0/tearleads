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
import {
  describeSyncStatus,
  selectBillingBlock,
  summarizePendingWrites,
} from "./syncStatusModel";
import { describeSyncStatusDetails } from "./syncStatusPopoverModel";
import { useLastOfflineWindow } from "./useLastOfflineWindow";

// The device goes offline after the snapshot at 10:00 and comes back after
// the one at 10:10.
const WENT_OFFLINE = "2026-11-22T10:00:00.000Z";
const CAME_BACK = "2026-11-22T10:10:00.000Z";

// A lane that failed while offline and has its retry queued.
const OFFLINE_FAILURE: Partial<SyncLaneSnapshot> = {
  key: "documents:note",
  lastAction: "failed",
  lastError: "Failed to fetch",
  lastFailedAt: "2026-11-22T10:05:00.000Z",
  requested: true,
  status: "queued",
};

function reconnect(lanes: ReadonlyArray<SyncLaneSnapshot>) {
  const offline = transitionLaneReconnect(
    initialLaneReconnectState(true, snapshot([], "2026-11-22T09:00:00.000Z")),
    { online: false, snapshot: snapshot([], WENT_OFFLINE), type: "observed" },
  );
  const online = transitionLaneReconnect(offline, {
    online: true,
    snapshot: snapshot(lanes, CAME_BACK),
    type: "observed",
  });
  if (online.status !== "online") throw new Error("expected online");
  return online;
}

test("a failure from being offline is left out while its retry is queued or running", () => {
  const before = snapshot([lane(OFFLINE_FAILURE)], CAME_BACK);
  const { offlineWindow } = reconnect(before.lanes);
  // The window opens a few seconds before the drop was noticed.
  expect(offlineWindow).toEqual({
    from: "2026-11-22T09:59:55.000Z",
    to: CAME_BACK,
  });
  expect(summarizeSyncLanes(before, offlineWindow)).toEqual(NO_LANES);
  // A request that failed as the connection dropped, published in the very
  // snapshot that went offline or just before the browser noticed.
  for (const lastFailedAt of [WENT_OFFLINE, "2026-11-22T09:59:57.000Z"])
    expect(
      summarizeSyncLanes(
        snapshot([lane({ ...OFFLINE_FAILURE, lastFailedAt })]),
        offlineWindow,
      ).failed,
    ).toBe(0);
  expect(
    summarizeSyncLanes(
      snapshot([lane({ ...OFFLINE_FAILURE, requested: false, running: true })]),
      offlineWindow,
    ),
  ).toEqual({ failed: 0, firstError: null, running: 1 });

  // The retry fails again after the reconnect: that failure is today's.
  expect(
    summarizeSyncLanes(
      snapshot([
        lane({
          ...OFFLINE_FAILURE,
          lastError: "Sync failed (500)",
          lastFailedAt: "2026-11-22T10:10:05.000Z",
        }),
      ]),
      offlineWindow,
    ),
  ).toEqual({ failed: 1, firstError: "Sync failed (500)", running: 0 });
});

test("a brief drop hides no failure that a retry will not revisit", () => {
  const { offlineWindow } = reconnect([]);
  const counted = (overrides: Partial<SyncLaneSnapshot>) =>
    summarizeSyncLanes(snapshot([lane(overrides)]), offlineWindow).failed;
  // Recorded before the device went offline: not caused by being offline.
  expect(
    counted({ ...OFFLINE_FAILURE, lastFailedAt: "2026-11-22T09:59:00.000Z" }),
  ).toBe(1);
  // Recorded offline, but nothing is queued to retry it.
  expect(
    counted({ ...OFFLINE_FAILURE, requested: false, status: "error" }),
  ).toBe(1);
  // An abandoned run holds its lane until it settles; nothing retries it,
  // even when the lane also recorded an offline failure before it hung.
  expect(
    counted({
      ...OFFLINE_FAILURE,
      key: "documents:stuck",
      lastFailedAt: "2026-11-22T10:01:00.000Z",
      lastStartedAt: "2026-11-22T10:02:00.000Z",
      runAbandoned: true,
      running: true,
      status: "running",
    }),
  ).toBe(1);
  // Online from the start, nothing is blamed on being offline.
  const fresh = initialLaneReconnectState(true, snapshot([]));
  expect(fresh).toEqual({ offlineWindow: null, status: "online" });
  expect(
    summarizeSyncLanes(snapshot([lane(OFFLINE_FAILURE)]), null).failed,
  ).toBe(1);
  // Staying online keeps the same state, so the hook does not re-render.
  const online = reconnect([]);
  expect(
    transitionLaneReconnect(online, {
      online: true,
      snapshot: snapshot([], "2026-11-22T11:00:00.000Z"),
      type: "observed",
    }),
  ).toBe(online);
});

test("the first render back online already leaves the offline failures out, and later failures count", () => {
  const failedPerRender: number[] = [];
  const { rerender, result } = renderHook(
    ({ online, current }) => {
      const window = useLastOfflineWindow(online, current);
      const lanes = summarizeSyncLanes(current, window);
      // Offline hides failures anyway; what matters is every online render.
      if (online) failedPerRender.push(lanes.failed);
      return lanes;
    },
    { initialProps: { current: snapshot([], WENT_OFFLINE), online: false } },
  );
  rerender({
    current: snapshot([lane(OFFLINE_FAILURE)], CAME_BACK),
    online: true,
  });
  rerender({
    current: snapshot([lane(OFFLINE_FAILURE)], CAME_BACK),
    online: true,
  });
  expect(failedPerRender.length).toBeGreaterThan(0);
  expect(failedPerRender.every((failed) => failed === 0)).toBe(true);

  // The retry fails after the reconnect, in a later snapshot.
  rerender({
    current: snapshot(
      [
        lane({
          ...OFFLINE_FAILURE,
          lastError: "Sync failed (500)",
          lastFailedAt: "2026-11-22T10:10:05.000Z",
        }),
      ],
      "2026-11-22T10:10:05.000Z",
    ),
    online: true,
  });
  expect(result.current.failed).toBe(1);
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
    unavailableReason: null,
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

test("the active organization's billing block is named over another's", () => {
  expect(selectBillingBlock(true, true)).toBe("active");
  expect(selectBillingBlock(false, true)).toBe("other");
  expect(selectBillingBlock(false, false)).toBeNull();
});
