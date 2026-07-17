import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { ContainerContents } from "./containerContents";
import {
  type PreparedOrganizationRootRewrap,
  prepareOrganizationRootRewrapForGroup,
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

interface PrepareCall {
  accessLevel: string;
  containerId: string;
  groupId: string;
  options?: { requireExistingGrant?: boolean } | undefined;
}

type FakePreparation =
  | { status: "not-granted" }
  | {
      isCurrent(
        head: ReferencedPrincipalHead,
        containerId: string,
        organizationId: string,
      ): Promise<boolean>;
      rewrap(): Promise<boolean>;
      status: "prepared";
    };

function createFakeContainerContents(input: {
  initialNodes: FakeNode[];
  nodesAfterRefresh?: FakeNode[];
  prepareGroupRewrap?: (call: PrepareCall) => Promise<FakePreparation | null>;
}): {
  containerContents: ContainerContents;
  prepareCalls: PrepareCall[];
  refreshCount: () => number;
} {
  let nodes = input.initialNodes;
  let refreshCount = 0;
  const prepareCalls: PrepareCall[] = [];
  const tree = {
    getSnapshot: () => ({ nodes }),
    refresh: async () => {
      refreshCount += 1;
      nodes = input.nodesAfterRefresh ?? nodes;
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
        : {
            isCurrent: async () => false,
            rewrap: async () => true,
            status: "prepared" as const,
          };
    },
  };

  return {
    containerContents: {
      openTree: () => tree,
    } as unknown as ContainerContents,
    prepareCalls,
    refreshCount: () => refreshCount,
  };
}

async function requirePrepared(
  containerContents: ContainerContents,
): Promise<PreparedOrganizationRootRewrap> {
  const prepared = await prepareOrganizationRootRewrapForGroup({
    containerContents,
    groupId: ADMIN_GROUP_ID,
    organizationId: ORGANIZATION_ID,
  });
  if (!prepared) {
    throw new Error("Expected a matching verified root admin grant");
  }
  return prepared;
}

test("prepares root key material for the verified direct admin group", async () => {
  let rewrapCalls = 0;
  const { containerContents, prepareCalls } = createFakeContainerContents({
    initialNodes: [
      { id: "matching-root", organizationId: ORGANIZATION_ID, parentId: null },
    ],
    prepareGroupRewrap: async () => ({
      isCurrent: async () => rewrapCalls > 0,
      rewrap: async () => {
        rewrapCalls += 1;
        return true;
      },
      status: "prepared",
    }),
  });

  const prepared = await requirePrepared(containerContents);
  expect(prepareCalls).toEqual([
    {
      accessLevel: "admin",
      containerId: "matching-root",
      groupId: ADMIN_GROUP_ID,
      options: { requireExistingGrant: true },
    },
  ]);
  expect(rewrapCalls).toBe(0);

  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await prepared.rewrap();
  expect(rewrapCalls).toBe(1);
});

test("a forged read-model group substitution is a verified no-op", async () => {
  const { containerContents, prepareCalls } = createFakeContainerContents({
    initialNodes: [
      { id: "matching-root", organizationId: ORGANIZATION_ID, parentId: null },
    ],
    prepareGroupRewrap: async () => ({ status: "not-granted" }),
  });

  const prepared = await prepareOrganizationRootRewrapForGroup({
    containerContents,
    groupId: "forged-read-model-admins-id",
    organizationId: ORGANIZATION_ID,
  });

  expect(prepared).toBeNull();
  expect(prepareCalls[0]?.groupId).toBe("forged-read-model-admins-id");
});

test("refreshes and retries a prepared re-wrap once", async () => {
  let rewrapCalls = 0;
  const { containerContents, refreshCount } = createFakeContainerContents({
    initialNodes: [
      { id: "matching-root", organizationId: ORGANIZATION_ID, parentId: null },
    ],
    prepareGroupRewrap: async () => ({
      isCurrent: async () => rewrapCalls === 2,
      rewrap: async () => {
        rewrapCalls += 1;
        return rewrapCalls === 2;
      },
      status: "prepared",
    }),
  });
  const prepared = await requirePrepared(containerContents);
  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await prepared.rewrap();

  expect(rewrapCalls).toBe(2);
  expect(refreshCount()).toBe(1);
});

test("rejects when the resulting root admin grant cannot be verified", async () => {
  let rewrapCalls = 0;
  const { containerContents, refreshCount } = createFakeContainerContents({
    initialNodes: [
      { id: "matching-root", organizationId: ORGANIZATION_ID, parentId: null },
    ],
    prepareGroupRewrap: async () => ({
      isCurrent: async () => false,
      rewrap: async () => {
        rewrapCalls += 1;
        return true;
      },
      status: "prepared",
    }),
  });
  const prepared = await requirePrepared(containerContents);
  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);

  await expect(prepared.rewrap()).rejects.toThrow(
    "Organization root admin re-wrap did not apply",
  );
  expect(rewrapCalls).toBe(2);
  expect(refreshCount()).toBe(1);
});

test("accepts a verified re-wrap after response loss", async () => {
  let currentChecks = 0;
  let rewrapCalls = 0;
  const { containerContents, refreshCount } = createFakeContainerContents({
    initialNodes: [
      { id: "matching-root", organizationId: ORGANIZATION_ID, parentId: null },
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
      status: "prepared",
    }),
  });
  const prepared = await requirePrepared(containerContents);
  prepared.setExpectedGroupPolicyHead(EXPECTED_GROUP_HEAD);
  await prepared.rewrap();

  expect(rewrapCalls).toBe(1);
  expect(refreshCount()).toBe(1);
});

test("fails closed before commit when root key preparation is unavailable", async () => {
  const { containerContents } = createFakeContainerContents({
    initialNodes: [
      { id: "matching-root", organizationId: ORGANIZATION_ID, parentId: null },
    ],
    prepareGroupRewrap: async () => null,
  });

  await expect(requirePrepared(containerContents)).rejects.toThrow(
    "Organization root re-wrap could not be prepared",
  );
});

test("refreshes once to resolve the organization root", async () => {
  const { containerContents, refreshCount } = createFakeContainerContents({
    initialNodes: [
      { id: "other-root", organizationId: "org-2", parentId: null },
    ],
    nodesAfterRefresh: [
      { id: "matching-root", organizationId: ORGANIZATION_ID, parentId: null },
    ],
  });

  await requirePrepared(containerContents);
  expect(refreshCount()).toBe(1);
});

test("rejects when the organization root remains unreachable", async () => {
  const { containerContents, refreshCount } = createFakeContainerContents({
    initialNodes: [],
    nodesAfterRefresh: [
      { id: "other-root", organizationId: "org-2", parentId: null },
    ],
  });

  await expect(requirePrepared(containerContents)).rejects.toThrow(
    "Organization root container is not reachable",
  );
  expect(refreshCount()).toBe(1);
});

test("rejects a committed head for a substituted group", async () => {
  const { containerContents } = createFakeContainerContents({
    initialNodes: [
      { id: "matching-root", organizationId: ORGANIZATION_ID, parentId: null },
    ],
  });
  const prepared = await requirePrepared(containerContents);

  expect(() =>
    prepared.setExpectedGroupPolicyHead({
      ...EXPECTED_GROUP_HEAD,
      principalId: "substituted-group",
    }),
  ).toThrow("Organization root re-wrap group policy mismatch");
});
