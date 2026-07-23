import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import type {
  DirectoryRefreshOptions,
  DirectoryRefreshResult,
} from "../refresh";
import { useOrgManagerRefreshers } from "./useOrgManagerRefreshers";

afterEach(() => cleanup());

const ORGANIZATION_ID = "00000000-0000-4000-8000-00000000000a";

const localDirectoryState = {
  directory: {
    organizationId: ORGANIZATION_ID,
    currentUser: { isOrgAdmin: true },
    profileDocumentId: null,
    users: [],
  },
  groups: [],
  memberGroupId: "group-members",
  readModelCursor: "cursor-1",
};

function createRefresherHarness(input: {
  readonly loadDirectoryAndGroups: () => Promise<unknown>;
  readonly loadLocalDirectoryAndGroups: () => Promise<unknown>;
}) {
  const directoryValues: unknown[] = [];
  const errors: Array<string | null> = [];
  const settledValues: boolean[] = [];
  const noop = () => undefined;
  const params = {
    appData: {
      auth: {
        isAuthenticated: true,
        organizationId: ORGANIZATION_ID,
        userId: "00000000-0000-4000-8000-00000000001a",
      },
    },
    beginRequest: (_key: string) => () => true,
    canLoadAuthenticatedOrgData: true,
    dataUsageRef: { current: null },
    orgManagerActions: {
      loadDirectoryAndGroups: input.loadDirectoryAndGroups,
      loadDirectoryAndGroupsAfterMutation: input.loadDirectoryAndGroups,
      loadLocalDirectoryAndGroups: input.loadLocalDirectoryAndGroups,
    },
    resetSelectedRosterUser: noop,
    selectGroup: noop,
    selectedGroupIdRef: { current: null },
    selectedGroupStateHashRef: { current: null },
    selectedUserIdRef: { current: null },
    skippedGroupDetailsEffectRef: { current: null },
    setDataUsage: noop,
    setDirectory: (value: unknown) => {
      directoryValues.push(value);
    },
    setError: (value: string | null) => {
      errors.push(value);
    },
    setGrants: noop,
    setGroupContainers: noop,
    setGroupPolicyHistory: noop,
    setGroups: noop,
    markDataUsageSettled: noop,
    markDirectorySettled: () => {
      settledValues.push(true);
    },
    markGrantsSettled: noop,
    markGroupDetailsSettled: noop,
    markOrganizationPolicyHistorySettled: noop,
    setLoading: noop,
    setLoadingUserDetail: noop,
    setMemberGroupId: noop,
    setMembers: noop,
    setOrganizationPolicyHistory: noop,
    setReadModelCursor: noop,
    setIsCreateGroupDialogOpen: noop,
    setIsImportUserDialogOpen: noop,
    setUserDetail: noop,
    view: "directory",
  } as unknown as Parameters<typeof useOrgManagerRefreshers>[0];
  const view = renderHook(() => useOrgManagerRefreshers(params));
  return {
    directoryValues,
    errors,
    settledValues,
    refreshDirectoryAndGroups: (
      options?: DirectoryRefreshOptions,
    ): Promise<DirectoryRefreshResult> =>
      view.result.current.refreshDirectoryAndGroups(options),
  };
}

test("a transient null reconcile keeps the painted local projection", async () => {
  const harness = createRefresherHarness({
    // The SDK declines without I/O when offline or the database is not ready.
    loadDirectoryAndGroups: async () => undefined,
    loadLocalDirectoryAndGroups: async () => localDirectoryState,
  });

  const result = await harness.refreshDirectoryAndGroups();

  expect(result.didLoad).toBe(true);
  expect(harness.directoryValues).toEqual([
    localDirectoryState.directory,
    localDirectoryState.directory,
  ]);
  expect(harness.errors).not.toContain(
    ORG_MANAGER_LABELS.failedLoadDirectoryGroups,
  );
});

test("an authoritative purge during reconcile resets the directory state", async () => {
  let localLoads = 0;
  const harness = createRefresherHarness({
    loadDirectoryAndGroups: async () => null,
    // The first local load paints last-known-good; the reread after the null
    // reconcile finds the projection purged by the authoritative denial.
    loadLocalDirectoryAndGroups: async () => {
      localLoads += 1;
      return localLoads === 1 ? localDirectoryState : null;
    },
  });

  const result = await harness.refreshDirectoryAndGroups();

  expect(result.didLoad).toBe(false);
  expect(harness.directoryValues).toEqual([
    localDirectoryState.directory,
    null,
  ]);
  expect(harness.errors).toContain(
    ORG_MANAGER_LABELS.failedLoadDirectoryGroups,
  );
});

test("a missing local projection on a local-only pass is not an error", async () => {
  const harness = createRefresherHarness({
    loadDirectoryAndGroups: async () => {
      throw new Error("local-only pass must not reconcile");
    },
    loadLocalDirectoryAndGroups: async () => null,
  });

  const result = await harness.refreshDirectoryAndGroups({ localOnly: true });

  expect(result.didLoad).toBe(false);
  expect(harness.directoryValues).toEqual([null]);
  expect(harness.errors).not.toContain(
    ORG_MANAGER_LABELS.failedLoadDirectoryGroups,
  );
});

test("a completed pass marks the scope settled even when it found nothing", async () => {
  // "Settled" is what lets the views distinguish an empty organization from one
  // that has not been fetched yet, so a pass that produces no directory must
  // still record that it looked.
  const harness = createRefresherHarness({
    loadDirectoryAndGroups: async () => undefined,
    loadLocalDirectoryAndGroups: async () => undefined,
  });

  await harness.refreshDirectoryAndGroups();

  expect(harness.settledValues).toEqual([true]);
});

test("a pass that does not manage the loading flag still settles the scope", async () => {
  const harness = createRefresherHarness({
    loadDirectoryAndGroups: async () => localDirectoryState,
    loadLocalDirectoryAndGroups: async () => localDirectoryState,
  });

  await harness.refreshDirectoryAndGroups({ manageLoading: false });

  expect(harness.settledValues).toEqual([true]);
});
