import { expect, test } from "bun:test";
import type { ContainerContents } from "./containerContents";
import {
  prepareOrganizationRootRewrapToAdmins,
  reshareOrganizationRootToAdmins,
} from "./organizationRootReshare";

const ADMIN_GROUP_ID = "admins-group-1";
const ORGANIZATION_ID = "org-1";
const EXPECTED_GROUP_HEAD = {
  principalType: "group" as const,
  principalId: ADMIN_GROUP_ID,
  version: 2,
  keyEpoch: 2,
  stateHash: "expected-admins-state-hash",
  keyFingerprint: "expected-admins-key-fingerprint",
};

interface FakeNode {
  id: string;
  organizationId: string;
  parentId: string | null;
}

interface ShareCall {
  accessLevel: string;
  containerId: string;
  groupId: string;
  options?: { requireExistingGrant?: boolean } | undefined;
}

type PrepareCall = ShareCall;

function createFakeContainerContents(input: {
  initialNodes: FakeNode[];
  nodesAfterRefresh?: FakeNode[];
  prepareGroupRewrap?: (call: PrepareCall) => Promise<{
    isCurrent(): Promise<boolean>;
    rewrap(): Promise<boolean>;
  } | null>;
  shareWithGroup?: (call: ShareCall) => Promise<boolean>;
}): {
  containerContents: ContainerContents;
  prepareCalls: PrepareCall[];
  refreshCount: () => number;
  shareCalls: ShareCall[];
} {
  let nodes = input.initialNodes;
  let refreshCount = 0;
  const shareCalls: ShareCall[] = [];
  const prepareCalls: PrepareCall[] = [];
  const tree = {
    getSnapshot: () => ({ nodes }),
    refresh: async () => {
      refreshCount += 1;
      if (input.nodesAfterRefresh) {
        nodes = input.nodesAfterRefresh;
      }
      return true;
    },
    prepareGroupRewrap: async (
      containerId: string,
      groupId: string,
      accessLevel: string,
      options?: { requireExistingGrant?: boolean },
    ) => {
      const call = { accessLevel, containerId, groupId, options };
      prepareCalls.push(call);
      return input.prepareGroupRewrap
        ? input.prepareGroupRewrap(call)
        : { isCurrent: async () => false, rewrap: async () => true };
    },
    shareWithGroup: async (
      containerId: string,
      groupId: string,
      accessLevel: string,
      options?: { requireExistingGrant?: boolean },
    ) => {
      const call = { accessLevel, containerId, groupId, options };
      shareCalls.push(call);
      return (await input.shareWithGroup?.(call)) ?? true;
    },
  };

  return {
    containerContents: {
      openTree: () => tree,
    } as unknown as ContainerContents,
    prepareCalls,
    refreshCount: () => refreshCount,
    shareCalls,
  };
}

test("re-shares the matching organization's root to Admins", async () => {
  const { containerContents, refreshCount, shareCalls } =
    createFakeContainerContents({
      initialNodes: [
        { id: "other-root", organizationId: "org-2", parentId: null },
        {
          id: "matching-child",
          organizationId: ORGANIZATION_ID,
          parentId: "matching-root",
        },
        {
          id: "matching-root",
          organizationId: ORGANIZATION_ID,
          parentId: null,
        },
      ],
    });

  await reshareOrganizationRootToAdmins({
    adminGroupId: ADMIN_GROUP_ID,
    containerContents,
    organizationId: ORGANIZATION_ID,
  });

  expect(refreshCount()).toBe(0);
  expect(shareCalls).toEqual([
    {
      accessLevel: "admin",
      containerId: "matching-root",
      groupId: ADMIN_GROUP_ID,
      options: { requireExistingGrant: true },
    },
  ]);
});

test("prepares root key material before applying the Admins re-wrap", async () => {
  let rewrapCalls = 0;
  const { containerContents, prepareCalls, refreshCount, shareCalls } =
    createFakeContainerContents({
      initialNodes: [
        {
          id: "matching-root",
          organizationId: ORGANIZATION_ID,
          parentId: null,
        },
      ],
      prepareGroupRewrap: async () => ({
        isCurrent: async () => rewrapCalls > 0,
        rewrap: async () => {
          rewrapCalls += 1;
          return true;
        },
      }),
    });

  const prepared = await prepareOrganizationRootRewrapToAdmins({
    adminGroupId: ADMIN_GROUP_ID,
    containerContents,
    organizationId: ORGANIZATION_ID,
  });

  expect(prepareCalls).toEqual([
    {
      accessLevel: "admin",
      containerId: "matching-root",
      groupId: ADMIN_GROUP_ID,
      options: { requireExistingGrant: true },
    },
  ]);
  expect(rewrapCalls).toBe(0);
  expect(shareCalls).toEqual([]);

  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await prepared.rewrap();
  expect(rewrapCalls).toBe(1);
  expect(refreshCount()).toBe(0);
});

test("refreshes and retries a prepared re-wrap once", async () => {
  let rewrapCalls = 0;
  const { containerContents, refreshCount } = createFakeContainerContents({
    initialNodes: [
      {
        id: "matching-root",
        organizationId: ORGANIZATION_ID,
        parentId: null,
      },
    ],
    prepareGroupRewrap: async () => ({
      isCurrent: async () => rewrapCalls === 2,
      rewrap: async () => {
        rewrapCalls += 1;
        return rewrapCalls === 2;
      },
    }),
  });
  const prepared = await prepareOrganizationRootRewrapToAdmins({
    adminGroupId: ADMIN_GROUP_ID,
    containerContents,
    organizationId: ORGANIZATION_ID,
  });

  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await prepared.rewrap();

  expect(rewrapCalls).toBe(2);
  expect(refreshCount()).toBe(1);
});

test("rejects a re-wrap whose current Admins grant cannot be verified", async () => {
  let rewrapCalls = 0;
  let currentChecks = 0;
  const { containerContents, refreshCount } = createFakeContainerContents({
    initialNodes: [
      {
        id: "matching-root",
        organizationId: ORGANIZATION_ID,
        parentId: null,
      },
    ],
    prepareGroupRewrap: async () => ({
      isCurrent: async () => {
        currentChecks += 1;
        return false;
      },
      rewrap: async () => {
        rewrapCalls += 1;
        return true;
      },
    }),
  });
  const prepared = await prepareOrganizationRootRewrapToAdmins({
    adminGroupId: ADMIN_GROUP_ID,
    containerContents,
    organizationId: ORGANIZATION_ID,
  });

  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await expect(prepared.rewrap()).rejects.toThrow(
    "Organization root re-share to Admins did not apply",
  );

  expect(rewrapCalls).toBe(2);
  expect(currentChecks).toBe(4);
  expect(refreshCount()).toBe(1);
});

test("accepts a cryptographically verified re-wrap after response loss", async () => {
  let rewrapCalls = 0;
  let currentChecks = 0;
  const { containerContents, refreshCount } = createFakeContainerContents({
    initialNodes: [
      {
        id: "matching-root",
        organizationId: ORGANIZATION_ID,
        parentId: null,
      },
    ],
    prepareGroupRewrap: async () => ({
      isCurrent: async () => {
        currentChecks += 1;
        return currentChecks > 1;
      },
      rewrap: async () => {
        rewrapCalls += 1;
        throw new Error("response lost after commit");
      },
    }),
  });
  const prepared = await prepareOrganizationRootRewrapToAdmins({
    adminGroupId: ADMIN_GROUP_ID,
    containerContents,
    organizationId: ORGANIZATION_ID,
  });

  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await prepared.rewrap();

  expect(rewrapCalls).toBe(1);
  expect(currentChecks).toBe(2);
  expect(refreshCount()).toBe(1);
});

test("rechecks a completed re-wrap when the Admins policy advances again", async () => {
  let rootIsCurrent = false;
  let rewrapCalls = 0;
  const { containerContents } = createFakeContainerContents({
    initialNodes: [
      {
        id: "matching-root",
        organizationId: ORGANIZATION_ID,
        parentId: null,
      },
    ],
    prepareGroupRewrap: async () => ({
      isCurrent: async () => rootIsCurrent,
      rewrap: async () => {
        rewrapCalls += 1;
        rootIsCurrent = true;
        return true;
      },
    }),
  });
  const prepared = await prepareOrganizationRootRewrapToAdmins({
    adminGroupId: ADMIN_GROUP_ID,
    containerContents,
    organizationId: ORGANIZATION_ID,
  });

  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await prepared.rewrap();
  rootIsCurrent = false;
  await prepared.rewrap();

  expect(rewrapCalls).toBe(2);
});

test("rejects when root key material cannot be prepared", async () => {
  const { containerContents } = createFakeContainerContents({
    initialNodes: [
      {
        id: "matching-root",
        organizationId: ORGANIZATION_ID,
        parentId: null,
      },
    ],
    prepareGroupRewrap: async () => null,
  });

  await expect(
    prepareOrganizationRootRewrapToAdmins({
      adminGroupId: ADMIN_GROUP_ID,
      containerContents,
      organizationId: ORGANIZATION_ID,
    }),
  ).rejects.toThrow("Organization root re-wrap could not be prepared");
});

test("refreshes once when the organization root is not loaded", async () => {
  const { containerContents, refreshCount, shareCalls } =
    createFakeContainerContents({
      initialNodes: [
        { id: "other-root", organizationId: "org-2", parentId: null },
      ],
      nodesAfterRefresh: [
        {
          id: "matching-root",
          organizationId: ORGANIZATION_ID,
          parentId: null,
        },
      ],
    });

  await reshareOrganizationRootToAdmins({
    adminGroupId: ADMIN_GROUP_ID,
    containerContents,
    organizationId: ORGANIZATION_ID,
  });

  expect(refreshCount()).toBe(1);
  expect(shareCalls.map((call) => call.containerId)).toEqual(["matching-root"]);
});

test("rejects when the organization root remains unreachable", async () => {
  const { containerContents, refreshCount, shareCalls } =
    createFakeContainerContents({
      initialNodes: [],
      nodesAfterRefresh: [
        { id: "other-root", organizationId: "org-2", parentId: null },
      ],
    });

  await expect(
    reshareOrganizationRootToAdmins({
      adminGroupId: ADMIN_GROUP_ID,
      containerContents,
      organizationId: ORGANIZATION_ID,
    }),
  ).rejects.toThrow("Organization root container is not reachable");
  expect(refreshCount()).toBe(1);
  expect(shareCalls).toEqual([]);
});

test("rejects when the root re-share does not apply", async () => {
  const { containerContents, refreshCount, shareCalls } =
    createFakeContainerContents({
      initialNodes: [
        {
          id: "matching-root",
          organizationId: ORGANIZATION_ID,
          parentId: null,
        },
      ],
      shareWithGroup: async () => false,
    });

  await expect(
    reshareOrganizationRootToAdmins({
      adminGroupId: ADMIN_GROUP_ID,
      containerContents,
      organizationId: ORGANIZATION_ID,
    }),
  ).rejects.toThrow("Organization root re-share to Admins did not apply");
  expect(refreshCount()).toBe(0);
  expect(shareCalls).toHaveLength(1);
});

test("propagates root re-share errors", async () => {
  const { containerContents } = createFakeContainerContents({
    initialNodes: [
      {
        id: "matching-root",
        organizationId: ORGANIZATION_ID,
        parentId: null,
      },
    ],
    shareWithGroup: async () => {
      throw new Error("share failed");
    },
  });

  await expect(
    reshareOrganizationRootToAdmins({
      adminGroupId: ADMIN_GROUP_ID,
      containerContents,
      organizationId: ORGANIZATION_ID,
    }),
  ).rejects.toThrow("share failed");
});
