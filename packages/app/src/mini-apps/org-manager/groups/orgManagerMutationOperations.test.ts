import { expect, mock, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { ORG_MANAGER_LABELS } from "../labels";
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

const MEMBERS: OrganizationGroupMembers = {
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
    importUserById: unusedAsync,
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
  const imported = deferred<{ userId: string } | null>();
  const addUserToGroup = mock(async () => undefined as never);
  const actions = createActions({
    addUserToGroup,
    importUserById: mock(() => imported.promise),
    loadGroupMembers: mock(async () => MEMBERS),
  });
  const { observed, setError } = createErrorSetter();

  const resultPromise = prepareRosterImport({
    directory: DIRECTORY,
    isOperationActive,
    memberGroupId: MEMBERS.groupId,
    operationOrganizationId: DIRECTORY.organizationId,
    orgManagerActions: actions,
    setError,
    targetUserId: TARGET_USER.userId,
  });
  active = false;
  imported.resolve(TARGET_USER);

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
    importUserById: mock(async () => TARGET_USER),
    loadGroupMembers: mock(async () => MEMBERS),
  });

  const result = await prepareRosterImport({
    directory: DIRECTORY,
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

test("adding a roster user stops before the write when an import resolves in a stale organization", async () => {
  let active = true;
  const isOperationActive = () => active;
  const imported = deferred<{ userId: string } | null>();
  const addUserToGroup = mock(async () => undefined as never);
  const actions = createActions({
    addUserToGroup,
    importUserById: mock(() => imported.promise),
  });

  const resultPromise = addRosterUserToGroup({
    directoryUser: undefined,
    groupId: "custom-group",
    groupName: "Operators",
    isAdminGroup: false,
    isOperationActive,
    memberGroupId: null,
    operationOrganizationId: DIRECTORY.organizationId,
    orgManagerActions: actions,
    setError: createErrorSetter().setError,
    targetUserId: TARGET_USER.userId,
  });
  active = false;
  imported.resolve(TARGET_USER);

  expect(await resultPromise).toBeNull();
  expect(addUserToGroup).not.toHaveBeenCalled();
});

test("adding a roster user reports a stale result when the organization changes during the write", async () => {
  let active = true;
  const isOperationActive = () => active;
  const addUserToGroup = mock(async () => {
    active = false;
    return undefined as never;
  });
  const actions = createActions({
    addUserToGroup,
    importUserById: mock(async () => TARGET_USER),
  });

  const result = await addRosterUserToGroup({
    directoryUser: undefined,
    groupId: "custom-group",
    groupName: "Operators",
    isAdminGroup: false,
    isOperationActive,
    memberGroupId: null,
    operationOrganizationId: DIRECTORY.organizationId,
    orgManagerActions: actions,
    setError: createErrorSetter().setError,
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

test("a failed Admins add after a Members add reports the user is now a billed member", async () => {
  // The two writes cannot be one transaction. When the second fails the first
  // has already landed, so the user is an organization member and on the
  // invoice; reporting a bare failure would hide that.
  const addUserToGroup = mock(async (groupId: string) => {
    if (groupId === "admins") {
      throw new Error("policy write failed");
    }
    return undefined as never;
  });
  const { observed, setError } = createErrorSetter();
  const actions = createActions({
    addUserToGroup,
    loadGroupMembers: mock(async () => MEMBERS),
  });

  const result = await addRosterUserToGroup({
    directoryUser: { ...TARGET_USER } as never,
    groupId: "admins",
    groupName: "Admins",
    isAdminGroup: true,
    isOperationActive: () => true,
    memberGroupId: "members",
    operationOrganizationId: DIRECTORY.organizationId,
    orgManagerActions: actions,
    setError,
    targetUserId: TARGET_USER.userId,
  });

  expect(result).toBeNull();
  expect(addUserToGroup).toHaveBeenCalledTimes(2);
  expect(addUserToGroup).toHaveBeenNthCalledWith(
    1,
    "members",
    TARGET_USER.userId,
    "Members",
  );
  expect(addUserToGroup).toHaveBeenNthCalledWith(
    2,
    "admins",
    TARGET_USER.userId,
    "Admins",
  );
  expect(observed).toContain(ORG_MANAGER_LABELS.failedAddAdminAfterMemberAdd);
});
