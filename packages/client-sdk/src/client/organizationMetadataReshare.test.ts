import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { getOrganizationProfileDocumentLocalId } from "../workflows/organizations/organizationProfile";
import { deriveOrganizationMetadataContainerSystemSlot } from "../workflows/organizations/rosterProfileContainer";
import type { ContainerContents } from "./containerContents";
import { reshareOrganizationMetadataAfterGroupChange } from "./organizationMetadataReshare";

const ORGANIZATION_ID = "org-1";
const MEMBER_GROUP_ID = "members-group-1";

interface ShareCall {
  accessLevel: string;
  containerId: string;
  groupId: string;
  options?: { requireExistingGrant?: boolean } | undefined;
}

interface PullCall {
  containerId: string;
  localId: string;
  documentId?: string | null | undefined;
}

interface FakeNode {
  id: string;
  systemSlot?: string;
}

function createFakeContainerContents(input: {
  initialNodes: FakeNode[];
  nodesAfterRefresh?: FakeNode[];
  shareWithGroup?: (call: ShareCall) => Promise<boolean>;
}): {
  containerContents: ContainerContents;
  pullCalls: PullCall[];
  refreshCount: () => number;
  shareCalls: ShareCall[];
} {
  let nodes = input.initialNodes;
  let refreshCount = 0;
  const shareCalls: ShareCall[] = [];
  const pullCalls: PullCall[] = [];
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
      shareCalls.push(call);
      const applies = (await input.shareWithGroup?.(call)) ?? true;
      return applies
        ? {
            isCurrent: async () => false,
            rewrap: async () => true,
            status: "prepared" as const,
          }
        : { status: "not-granted" as const };
    },
  };
  const containerContents = {
    openTree: () => tree,
    pullDocumentContent: (call: PullCall) => {
      pullCalls.push(call);
    },
  } as unknown as ContainerContents;
  return {
    containerContents,
    pullCalls,
    refreshCount: () => refreshCount,
    shareCalls,
  };
}

test("re-shares the org metadata container to the members group when it is the mutated group", async () => {
  const slot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: ORGANIZATION_ID,
  });
  const { containerContents, pullCalls, refreshCount, shareCalls } =
    createFakeContainerContents({
      initialNodes: [
        { id: "root" },
        { id: "metadata-container", systemSlot: slot },
      ],
    });

  await reshareOrganizationMetadataAfterGroupChange({
    containerContents,
    log: () => undefined,
    mutatedGroupId: MEMBER_GROUP_ID,
    organizationId: ORGANIZATION_ID,
  });

  expect(shareCalls).toEqual([
    {
      accessLevel: "read",
      containerId: "metadata-container",
      groupId: MEMBER_GROUP_ID,
      options: { requireExistingGrant: true },
    },
  ]);
  // Also pushes the org profile body so the freshly-granted members can pull it.
  expect(pullCalls).toEqual([
    {
      containerId: "metadata-container",
      localId: getOrganizationProfileDocumentLocalId({
        organizationId: ORGANIZATION_ID,
      }),
    },
  ]);
  // Found without needing a hydration refresh.
  expect(refreshCount()).toBe(0);
});

test("an unrelated mutated group cannot mint a metadata grant or pull content", async () => {
  const slot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: ORGANIZATION_ID,
  });
  const { containerContents, pullCalls, refreshCount, shareCalls } =
    createFakeContainerContents({
      initialNodes: [{ id: "metadata-container", systemSlot: slot }],
      shareWithGroup: async () => false,
    });

  await reshareOrganizationMetadataAfterGroupChange({
    containerContents,
    log: () => undefined,
    mutatedGroupId: "some-custom-group",
    organizationId: ORGANIZATION_ID,
  });

  expect(shareCalls).toEqual([
    {
      accessLevel: "read",
      containerId: "metadata-container",
      groupId: "some-custom-group",
      options: { requireExistingGrant: true },
    },
  ]);
  expect(pullCalls).toEqual([]);
  expect(refreshCount()).toBe(0);
});

test("refreshes to hydrate the container when it is not yet loaded, then re-shares", async () => {
  const slot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: ORGANIZATION_ID,
  });
  const { containerContents, refreshCount, shareCalls } =
    createFakeContainerContents({
      initialNodes: [{ id: "root" }],
      nodesAfterRefresh: [{ id: "metadata-container", systemSlot: slot }],
    });

  await reshareOrganizationMetadataAfterGroupChange({
    containerContents,
    log: () => undefined,
    mutatedGroupId: MEMBER_GROUP_ID,
    organizationId: ORGANIZATION_ID,
  });

  expect(refreshCount()).toBe(1);
  expect(shareCalls).toEqual([
    {
      accessLevel: "read",
      containerId: "metadata-container",
      groupId: MEMBER_GROUP_ID,
      options: { requireExistingGrant: true },
    },
  ]);
});

test("skips and logs when the org metadata container stays unreachable", async () => {
  const { containerContents, refreshCount, shareCalls } =
    createFakeContainerContents({
      initialNodes: [{ id: "root" }],
    });
  const logs: string[] = [];

  await reshareOrganizationMetadataAfterGroupChange({
    containerContents,
    log: (message) => logs.push(message),
    mutatedGroupId: MEMBER_GROUP_ID,
    organizationId: ORGANIZATION_ID,
  });

  expect(refreshCount()).toBe(1);
  expect(shareCalls).toEqual([]);
  expect(logs.some((message) => message.includes("not reachable"))).toBe(true);
});

test("swallows errors so a re-share failure never surfaces to the caller", async () => {
  const slot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: ORGANIZATION_ID,
  });
  const { containerContents } = createFakeContainerContents({
    initialNodes: [{ id: "metadata-container", systemSlot: slot }],
    shareWithGroup: async () => {
      throw new Error("boom");
    },
  });
  const logs: string[] = [];

  // Resolves rather than rejects.
  await reshareOrganizationMetadataAfterGroupChange({
    containerContents,
    log: (message) => logs.push(message),
    mutatedGroupId: MEMBER_GROUP_ID,
    organizationId: ORGANIZATION_ID,
  });

  expect(
    logs.some((message) =>
      message.includes("best-effort org metadata re-share failed"),
    ),
  ).toBe(true);
});

test("propagates identity failures to the coordinator without logging them as availability failures", async () => {
  const slot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: ORGANIZATION_ID,
  });
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );
  const { containerContents, pullCalls } = createFakeContainerContents({
    initialNodes: [{ id: "metadata-container", systemSlot: slot }],
    shareWithGroup: async () => {
      throw integrityError;
    },
  });
  const logs: string[] = [];

  await expect(
    reshareOrganizationMetadataAfterGroupChange({
      containerContents,
      log: (message) => logs.push(message),
      mutatedGroupId: MEMBER_GROUP_ID,
      organizationId: ORGANIZATION_ID,
    }),
  ).rejects.toBe(integrityError);
  expect(pullCalls).toEqual([]);
  expect(logs).toEqual([]);
});
