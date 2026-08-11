import { expect, test } from "bun:test";
import {
  type DataUsageRefreshOptions,
  type DirectoryRefreshOptions,
  type GroupDetailsRefreshOptions,
  type RefreshBehaviorOptions,
  refreshOrgManagerVisibleData,
} from "./refresh";
import type { OrgManagerView } from "./routes";

function createRefreshHarness(view: OrgManagerView) {
  const calls: string[] = [];
  const directoryOptions: DirectoryRefreshOptions[] = [];
  let selectedUserId = "user-before-directory";

  return {
    calls,
    directoryOptions,
    refresh: () =>
      refreshOrgManagerVisibleData({
        getSelectedUserId: () => selectedUserId,
        refreshDataUsage: async (_options?: DataUsageRefreshOptions) => {
          calls.push("usage");
        },
        refreshDirectoryAndGroups: async (
          options: DirectoryRefreshOptions = {},
        ) => {
          calls.push("directory");
          directoryOptions.push(options);
          selectedUserId = "user-after-directory";
          return { didLoad: false as const, groupId: "group-a" };
        },
        refreshGrants: async (_options?: RefreshBehaviorOptions) => {
          calls.push("grants");
        },
        refreshOrganizationPolicyHistory: async (
          _options?: RefreshBehaviorOptions,
        ) => {
          calls.push("organization");
        },
        refreshSelectedGroupContainers: async (groupId: string | null) => {
          calls.push(`group-containers:${groupId}`);
        },
        refreshSelectedGroupDetails: async (
          groupId: string | null,
          _options?: GroupDetailsRefreshOptions,
        ) => {
          calls.push(`group:${groupId}`);
        },
        refreshSelectedUserDetail: async (
          userId: string | null,
          _options?: GroupDetailsRefreshOptions,
        ) => {
          calls.push(`user:${userId}`);
        },
        view,
      }),
  };
}

const visibleRefreshCases: ReadonlyArray<{
  expectedCalls: string[];
  view: OrgManagerView;
}> = [
  {
    expectedCalls: ["directory", "user:user-after-directory"],
    view: "directory",
  },
  {
    expectedCalls: ["directory", "group:group-a", "group-containers:group-a"],
    view: "groups",
  },
  {
    expectedCalls: ["directory", "organization"],
    view: "organization",
  },
  { expectedCalls: ["directory", "usage"], view: "usage" },
  { expectedCalls: ["directory"], view: "billing" },
  { expectedCalls: ["directory"], view: "menu" },
];

for (const { expectedCalls, view } of visibleRefreshCases) {
  test(`manual ${view} refresh loads only visible data`, async () => {
    const harness = createRefreshHarness(view);

    await harness.refresh();

    expect(harness.calls).toEqual(expectedCalls);
    expect(harness.directoryOptions).toEqual([
      {
        clearError: false,
        manageLoading: false,
        ...(view === "groups" ? { skipNextGroupDetailsEffect: true } : {}),
      },
    ]);
  });
}

test("manual grants refresh retains the broad directory reconcile", async () => {
  const harness = createRefreshHarness("grants");

  await harness.refresh();

  expect(harness.calls).toEqual(["directory", "grants"]);
  expect(harness.directoryOptions).toEqual([
    {
      clearError: false,
      manageLoading: false,
    },
  ]);
});
