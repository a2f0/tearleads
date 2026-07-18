import { expect, mock, test } from "bun:test";
import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalProjectionMemberResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import type { Dispatch, SetStateAction } from "react";
import { projectGroupMutationResult } from "./groupMutationProjection";
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

const DIRECTORY_USER: OrganizationDirectory["users"][number] = {
  createdAt: "2026-07-16T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint-target",
  encapsulationPublicKey: "encapsulation-public-key-target",
  isSelf: false,
  joinedAt: "2026-07-16T12:00:00.000Z",
  profileDocumentId: null,
  signingKeyFingerprint: "signing-fingerprint-target",
  signingPublicKey: "signing-public-key-target",
  status: "active",
  updatedAt: "2026-07-16T12:00:00.000Z",
  userId: TARGET_USER.userId,
};

const TARGET_GROUP: OrganizationGroupSummary = {
  createdAt: "2026-07-16T12:00:00.000Z",
  currentState: null,
  groupId: "target-group",
  isBuiltin: false,
  name: "Target group",
  organizationId: DIRECTORY.organizationId,
};

const NESTED_GROUP: OrganizationGroupSummary = {
  ...TARGET_GROUP,
  groupId: "nested-group",
  name: "Nested group",
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

function policyState(input: {
  memberCount: number;
  stateHash: string;
  version: number;
}): PrincipalStateResponse {
  return {
    createdAt: "2026-07-16T12:00:00.000Z",
    encapsulationPublicKey: `encapsulation-key-${input.version}`,
    externalAuthority: {
      keyEpoch: 1,
      keyFingerprint: "admins-key-fingerprint-1",
      principalId: "admins-group",
      principalType: "group",
      stateHash: "admins-state-1",
      version: 1,
    },
    keyEpoch: input.version,
    keyFingerprint: `key-fingerprint-${input.version}`,
    memberCount: input.memberCount,
    memberEnvelopesRoot: `envelopes-root-${input.version}`,
    membershipMode: "projection",
    membershipRoot: `membership-root-${input.version}`,
    payloadCiphertextHash: `payload-hash-${input.version}`,
    prevStateHash: input.version === 1 ? null : "state-1",
    principalId: TARGET_GROUP.groupId,
    principalType: "group",
    projectionRoot: `projection-root-${input.version}`,
    signature: `signature-${input.version}`,
    signedAt: "2026-07-16T12:00:00.000Z",
    signerUserId: "signer-user",
    signerUserKeyFingerprint: "signer-fingerprint",
    stateHash: input.stateHash,
    version: input.version,
  };
}

function policyBundle(input: {
  current: PrincipalProjectionMemberResponse[];
  previous?: PrincipalProjectionMemberResponse[];
}): PrincipalPolicyBundleResponse {
  const currentState = policyState({
    memberCount: input.current.length,
    stateHash: "state-2",
    version: 2,
  });
  const previous = input.previous ?? [];
  return {
    currentMemberEnvelopes: {
      envelopes: [],
      epoch: currentState.keyEpoch,
      principalId: TARGET_GROUP.groupId,
      principalType: "group",
      stateHash: currentState.stateHash,
    },
    currentPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: "ciphertext",
      ciphertextHash: currentState.payloadCiphertextHash,
      createdAt: currentState.createdAt,
      principalId: TARGET_GROUP.groupId,
      principalType: "group",
      stateHash: currentState.stateHash,
    },
    currentProjection: input.current,
    currentState,
    previousStates: [
      {
        projection: previous,
        state: policyState({
          memberCount: previous.length,
          stateHash: "state-1",
          version: 1,
        }),
      },
    ],
  };
}

function groupsForBundle(
  bundle: PrincipalPolicyBundleResponse,
): OrganizationGroupSummary[] {
  return [
    {
      ...TARGET_GROUP,
      currentState: {
        keyEpoch: bundle.currentState.keyEpoch,
        keyFingerprint: bundle.currentState.keyFingerprint,
        memberCount: bundle.currentState.memberCount,
        stateHash: bundle.currentState.stateHash,
        version: bundle.currentState.version,
      },
    },
    NESTED_GROUP,
  ];
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
    loadDirectoryAndGroupsAfterMutation: unusedAsync,
    loadLocalDirectoryAndGroups: unusedAsync,
    loadGrants: unusedAsync,
    loadGroupContainers: unusedAsync,
    loadGroupMembers: unusedAsync,
    loadGroupPresentationDetails: unusedAsync,
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

test("group mutation projection resolves user and nested-group roles", () => {
  const bundle = policyBundle({
    current: [
      {
        memberPrincipalId: TARGET_USER.userId,
        memberPrincipalType: "user",
        role: "admin",
      },
      {
        memberPrincipalId: NESTED_GROUP.groupId,
        memberPrincipalType: "group",
        role: "member",
      },
    ],
  });

  const projection = projectGroupMutationResult({
    bundle,
    directory: { ...DIRECTORY, users: [DIRECTORY_USER] },
    groupId: TARGET_GROUP.groupId,
    groups: groupsForBundle(bundle),
  });

  expect(projection?.members).toEqual({
    groupId: TARGET_GROUP.groupId,
    organizationId: DIRECTORY.organizationId,
    members: [
      {
        encapsulationKeyFingerprint: null,
        encapsulationPublicKey: null,
        groupId: NESTED_GROUP.groupId,
        groupName: NESTED_GROUP.name,
        memberPrincipalId: NESTED_GROUP.groupId,
        memberPrincipalType: "group",
        role: "member",
        signingKeyFingerprint: null,
        signingPublicKey: null,
        userId: null,
      },
      {
        encapsulationKeyFingerprint: DIRECTORY_USER.encapsulationKeyFingerprint,
        encapsulationPublicKey: DIRECTORY_USER.encapsulationPublicKey,
        groupId: null,
        groupName: null,
        memberPrincipalId: TARGET_USER.userId,
        memberPrincipalType: "user",
        role: "admin",
        signingKeyFingerprint: DIRECTORY_USER.signingKeyFingerprint,
        signingPublicKey: DIRECTORY_USER.signingPublicKey,
        userId: TARGET_USER.userId,
      },
    ],
  });
});

test("group mutation projection derives role changes and removals", () => {
  const bundle = policyBundle({
    current: [
      {
        memberPrincipalId: TARGET_USER.userId,
        memberPrincipalType: "user",
        role: "admin",
      },
    ],
    previous: [
      {
        memberPrincipalId: TARGET_USER.userId,
        memberPrincipalType: "user",
        role: "member",
      },
      {
        memberPrincipalId: NESTED_GROUP.groupId,
        memberPrincipalType: "group",
        role: "admin",
      },
    ],
  });
  const projection = projectGroupMutationResult({
    bundle,
    directory: { ...DIRECTORY, users: [DIRECTORY_USER] },
    groupId: TARGET_GROUP.groupId,
    groups: groupsForBundle(bundle),
  });

  expect(projection?.members.members.map((member) => member.role)).toEqual([
    "admin",
  ]);
  expect(projection?.policyHistory.entries[0]?.changes).toEqual([
    {
      changeType: "removed",
      memberPrincipalId: NESTED_GROUP.groupId,
      memberPrincipalType: "group",
      nextRole: null,
      previousRole: "admin",
    },
    {
      changeType: "role_changed",
      memberPrincipalId: TARGET_USER.userId,
      memberPrincipalType: "user",
      nextRole: "admin",
      previousRole: "member",
    },
  ]);
});

test("group mutation refresh falls back when a projection member is unknown", async () => {
  const invalidateSelectedGroupDetails = mock(() => {});
  const refreshSelectedGroupDetails = mock(async () => {});
  const refreshSelectedUserDetail = mock(async () => {});
  const setGroupPolicyHistory = mock(() => {});
  const setMembers = mock(() => {});
  const bundle = policyBundle({
    current: [
      {
        memberPrincipalId: "unknown-user",
        memberPrincipalType: "user",
        role: "member",
      },
    ],
  });

  await refreshAfterGroupMutation({
    invalidateSelectedGroupDetails,
    isOperationActive: () => true,
    mutationProjection: {
      bundle,
      groupId: TARGET_GROUP.groupId,
      setGroupPolicyHistory,
      setMembers,
    },
    operationOrganizationId: DIRECTORY.organizationId,
    refreshDirectoryAndGroups: mock(async () => ({
      didLoad: true as const,
      directory: { ...DIRECTORY, users: [DIRECTORY_USER] },
      groupId: TARGET_GROUP.groupId,
      groups: groupsForBundle(bundle),
    })),
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedUserIdRef: { current: TARGET_USER.userId },
  });

  expect(refreshSelectedGroupDetails).toHaveBeenCalledTimes(1);
  expect(invalidateSelectedGroupDetails).toHaveBeenCalledTimes(1);
  expect(refreshSelectedGroupDetails).toHaveBeenCalledWith(
    TARGET_GROUP.groupId,
  );
  expect(setMembers).not.toHaveBeenCalled();
  expect(setGroupPolicyHistory).not.toHaveBeenCalled();
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
    isOperationActive,
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
  );
  expect(result).toBeNull();
});
