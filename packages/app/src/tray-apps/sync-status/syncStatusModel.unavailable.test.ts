import { expect, test } from "bun:test";
import { DESCRIBED, NO_LANES, SETTLED } from "./syncStatus.testFixtures";
import {
  describeSyncStatus,
  resolveSyncStatus,
  resolveSyncUnavailableReason,
} from "./syncStatusModel";
import {
  describeSyncStatusDetails,
  listSyncStatusActions,
} from "./syncStatusPopoverModel";

const NO_IDENTITY = {
  databaseStatus: "idle",
  hasIdentity: false,
  identitySettled: true,
  isLocked: false,
} as const;

test("a device with no identity yet has nothing to sync", () => {
  expect(resolveSyncUnavailableReason(NO_IDENTITY)).toBe("no-identity");
});

test("the database is still on its way while the identity is looked for or switched", () => {
  expect(
    resolveSyncUnavailableReason({ ...NO_IDENTITY, identitySettled: false }),
  ).toBeNull();
  expect(
    resolveSyncUnavailableReason({ ...NO_IDENTITY, hasIdentity: true }),
  ).toBeNull();
});

test("locked keys and a failed database each name their own reason", () => {
  expect(resolveSyncUnavailableReason({ ...NO_IDENTITY, isLocked: true })).toBe(
    "locked",
  );
  expect(
    resolveSyncUnavailableReason({
      ...NO_IDENTITY,
      databaseStatus: "error",
      hasIdentity: true,
    }),
  ).toBe("database-failed");
});

test("an open database can always be read", () => {
  expect(
    resolveSyncUnavailableReason({ ...NO_IDENTITY, databaseStatus: "ready" }),
  ).toBeNull();
});

test("nothing to read is inactive, not loading, whatever else is reported", () => {
  for (const unavailableReason of ["no-identity", "locked"] as const) {
    expect(
      resolveSyncStatus({
        ...SETTLED,
        billingNeedsAttention: true,
        ready: false,
        unavailableReason,
      }),
    ).toBe("inactive");
  }
});

test("a database that did not open is an error rather than loading forever", () => {
  expect(
    resolveSyncStatus({
      ...SETTLED,
      ready: false,
      unavailableReason: "database-failed",
    }),
  ).toBe("error");
  expect(
    describeSyncStatus({
      ...DESCRIBED,
      status: "error",
      unavailableReason: "database-failed",
    }),
  ).toBe("Unable to check sync status — this device's data did not open");
});

test("an inactive status says why nothing syncs", () => {
  expect(
    describeSyncStatus({
      ...DESCRIBED,
      status: "inactive",
      unavailableReason: "no-identity",
    }),
  ).toBe("Not syncing — this device has no identity yet");
  expect(
    describeSyncStatus({
      ...DESCRIBED,
      status: "inactive",
      unavailableReason: "locked",
    }),
  ).toBe("Not syncing — this device is locked");
});

const LOADING_DETAILS = {
  downloads: { status: "loading" },
  lanes: NO_LANES,
  pausedOrganizationCount: 0,
  pendingWriteCount: 0,
  uploadingFileCount: 0,
} as const;

test("the popover says what would let the device sync instead of checking downloads", () => {
  expect(
    describeSyncStatusDetails({
      ...LOADING_DETAILS,
      unavailableReason: "no-identity",
    }),
  ).toEqual(["Create or restore an identity to start syncing."]);
  expect(
    describeSyncStatusDetails({
      ...LOADING_DETAILS,
      unavailableReason: "locked",
    }),
  ).toEqual(["Unlock this device to read and sync its data."]);
  expect(
    describeSyncStatusDetails({
      ...LOADING_DETAILS,
      unavailableReason: "database-failed",
    }),
  ).toEqual(["Nothing can sync until this device's data opens."]);
  expect(
    describeSyncStatusDetails({ ...LOADING_DETAILS, unavailableReason: null }),
  ).toContain("Downloads: checking…");
});

test("the popover offers no view of a queue the device cannot read", () => {
  expect(
    listSyncStatusActions({
      billingBlock: "other",
      canSync: true,
      downloads: { message: "Storage unavailable", status: "unreadable" },
      lanes: { failed: 1, firstError: "x", running: 1 },
      pendingWriteCount: 2,
      queueReadFailed: true,
      unavailableReason: "database-failed",
      uploadingFileCount: 1,
    }),
  ).toEqual([]);
});
