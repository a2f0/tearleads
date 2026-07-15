import { expect, mock, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationGroupDetails,
  OrganizationGroupMembers,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import {
  addRosterUserToGroup,
  prepareRosterImport,
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

const GROUP_DETAILS: OrganizationGroupDetails = {
  containers: null,
  members: MEMBERS,
  policyHistory: null,
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
    captureOperationScope: () => null,
    createGroup: unusedAsync,
    deleteGroup: unusedAsync,
    ensureOrganizationProfileDocument: unusedAsync,
    ensureRosterProfileContainer: unusedAsync,
    ensureRosterProfileDocument: unusedAsync,
    importUserById: unusedAsync,
    isOperationScopeActive: () => true,
    loadDataUsage: unusedAsync,
    loadDirectoryAndGroups: unusedAsync,
    loadGrants: unusedAsync,
    loadGroupDetails: unusedAsync,
    loadPolicyHistory: unusedAsync,
    loadUserDetail: unusedAsync,
    removeUserFromGroup: unusedAsync,
    revokeGrant: unusedAsync,
    updateProfile: unusedAsync,
    updateRosterEntry: unusedAsync,
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

test("roster import does not write after its organization changes during lookup", async () => {
  let active = true;
  const isOperationActive = () => active;
  const imported = deferred<{ userId: string } | null>();
  const addUserToGroup = mock(async () => undefined as never);
  const actions = createActions({
    addUserToGroup,
    importUserById: mock(() => imported.promise),
    loadGroupDetails: mock(async () => GROUP_DETAILS),
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
    loadGroupDetails: mock(async () => GROUP_DETAILS),
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
    true,
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
    directory: DIRECTORY,
    directoryUser: undefined,
    groupId: "custom-group",
    isOperationActive,
    operationOrganizationId: DIRECTORY.organizationId,
    orgManagerActions: actions,
    setError: createErrorSetter().setError,
    targetUserId: TARGET_USER.userId,
  });
  active = false;
  imported.resolve(TARGET_USER);

  expect(await resultPromise).toBe(false);
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
    directory: DIRECTORY,
    directoryUser: undefined,
    groupId: "custom-group",
    isOperationActive,
    operationOrganizationId: DIRECTORY.organizationId,
    orgManagerActions: actions,
    setError: createErrorSetter().setError,
    targetUserId: TARGET_USER.userId,
  });

  expect(addUserToGroup).toHaveBeenCalledTimes(1);
  expect(addUserToGroup).toHaveBeenCalledWith(
    "custom-group",
    TARGET_USER.userId,
    true,
  );
  expect(result).toBe(false);
});
