import { expect, mock, test } from "bun:test";
import type { OrganizationDirectory } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import {
  addRosterUserToGroup,
  prepareRosterImport,
  refreshAfterGroupMutation,
} from "./orgManagerMutationOperations";

type OrgManagerActions = Parameters<
  typeof prepareRosterImport
>[0]["orgManagerActions"];

const TARGET_USER = { userId: "target-user" };

const DIRECTORY: OrganizationDirectory = {
  currentUser: { isOrgAdmin: true },
  organizationId: "org-a",
  profileDocumentId: null,
  users: [],
};

// Shaped like the group-members route response the action returns.
const MEMBERS: NonNullable<
  Awaited<ReturnType<OrgManagerActions["loadGroupMembers"]>>
> = {
  groupId: "members",
  members: [],
  organizationId: DIRECTORY.organizationId,
};

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createActions(
  overrides: Partial<OrgManagerActions>,
): OrgManagerActions {
  const unusedAsync = async (..._args: unknown[]): Promise<never> => {
    throw new Error("Unexpected org-manager action");
  };

  return {
    addUserToGroup: unusedAsync,
    loadGroupMembers: unusedAsync,
    ...overrides,
  };
}

function createErrorSetter() {
  const observed: Array<string | null> = [];
  const setError: Dispatch<SetStateAction<string | null>> = (next) => {
    observed.push(typeof next === "function" ? next(null) : next);
  };
  return { observed, setError };
}

test("group mutation refresh reloads details through the local coordinator", async () => {
  const invalidateSelectedGroupDetails = mock(() => {});
  const refreshSelectedGroupDetails = mock(async () => {});
  const refreshSelectedUserDetail = mock(async () => {});
  const groupId = "target-group";

  await refreshAfterGroupMutation({
    invalidateSelectedGroupDetails,
    isOperationActive: () => true,
    mutationResult: null,
    operationOrganizationId: DIRECTORY.organizationId,
    refreshDirectoryAndGroups: mock(async () => ({
      didLoad: true as const,
      directory: DIRECTORY,
      groupId,
      groups: [],
    })),
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedUserIdRef: { current: TARGET_USER.userId },
  });

  expect(refreshSelectedGroupDetails).toHaveBeenCalledTimes(1);
  expect(invalidateSelectedGroupDetails).toHaveBeenCalledTimes(1);
  expect(refreshSelectedGroupDetails).toHaveBeenCalledWith(groupId);
  expect(refreshSelectedUserDetail).toHaveBeenCalledWith(TARGET_USER.userId);
});

test("roster import does not write after its organization changes during lookup", async () => {
  let active = true;
  const isOperationActive = () => active;
  const members = deferred<typeof MEMBERS | null>();
  const addUserToGroup = mock(async () => undefined as never);
  const actions = createActions({
    addUserToGroup,
    loadGroupMembers: mock(() => members.promise),
  });
  const { observed, setError } = createErrorSetter();

  const resultPromise = prepareRosterImport({
    isOperationActive,
    memberGroupId: MEMBERS.groupId,
    operationOrganizationId: DIRECTORY.organizationId,
    orgManagerActions: actions,
    setError,
    targetUserId: TARGET_USER.userId,
  });
  active = false;
  members.resolve(MEMBERS);

  expect(await resultPromise).toBeNull();
  expect(addUserToGroup).not.toHaveBeenCalled();
  expect(observed).toEqual([]);
});

test("roster import reports no result when the organization changes during its membership write", async () => {
  let active = true;
  const isOperationActive = () => active;
  const addUserToGroup = mock(async () => {
    active = false;
    return undefined as never;
  });
  const actions = createActions({
    addUserToGroup,
    loadGroupMembers: mock(async () => MEMBERS),
  });

  const result = await prepareRosterImport({
    isOperationActive,
    memberGroupId: MEMBERS.groupId,
    operationOrganizationId: DIRECTORY.organizationId,
    orgManagerActions: actions,
    setError: createErrorSetter().setError,
    targetUserId: TARGET_USER.userId,
  });

  expect(addUserToGroup).toHaveBeenCalledTimes(1);
  expect(addUserToGroup).toHaveBeenCalledWith(
    MEMBERS.groupId,
    TARGET_USER.userId,
    "Members",
  );
  expect(result).toBeNull();
});

test("adding a roster user reports a stale result when the organization changes during the write", async () => {
  let active = true;
  const isOperationActive = () => active;
  const addUserToGroup = mock(async () => {
    active = false;
    return undefined as never;
  });
  const actions = createActions({ addUserToGroup });

  const result = await addRosterUserToGroup({
    groupId: "custom-group",
    groupName: "Operators",
    isOperationActive,
    operationOrganizationId: DIRECTORY.organizationId,
    orgManagerActions: actions,
    targetUserId: TARGET_USER.userId,
  });

  expect(addUserToGroup).toHaveBeenCalledTimes(1);
  expect(addUserToGroup).toHaveBeenCalledWith(
    "custom-group",
    TARGET_USER.userId,
    "Operators",
  );
  expect(result).toBeNull();
});

test.each(["admins", "custom-group"])(
  "adding a new user to %s delegates one atomic membership operation",
  async (groupId) => {
    const addUserToGroup = mock(async () => {
      throw new Error("policy write failed");
    });
    const actions = createActions({ addUserToGroup });
    await expect(
      addRosterUserToGroup({
        groupId,
        groupName: "Target group",
        isOperationActive: () => true,
        operationOrganizationId: DIRECTORY.organizationId,
        orgManagerActions: actions,
        targetUserId: TARGET_USER.userId,
      }),
    ).rejects.toThrow("policy write failed");
    expect(addUserToGroup).toHaveBeenCalledTimes(1);
    expect(addUserToGroup).toHaveBeenCalledWith(
      groupId,
      TARGET_USER.userId,
      "Target group",
    );
  },
);
