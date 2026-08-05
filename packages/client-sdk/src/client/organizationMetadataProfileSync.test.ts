import { expect, test } from "bun:test";
import { getOrganizationProfileDocumentLocalId } from "../workflows/organizations/organizationProfile";
import { deriveOrganizationMetadataContainerSystemSlot } from "../workflows/organizations/rosterProfileContainer";
import type { ContainerContents } from "./containerContents";
import { syncOrganizationMetadataProfile } from "./organizationMetadataProfileSync";

const ORGANIZATION_ID = "org-1";

function fakeContainerContents(input: {
  readonly initialNodes: Array<{ id: string; systemSlot?: string }>;
  readonly nodesAfterRefresh?: Array<{ id: string; systemSlot?: string }>;
}) {
  let nodes = input.initialNodes;
  let refreshCount = 0;
  const pulls: Array<{ containerId: string; localId: string }> = [];
  return {
    contents: {
      openTree: () => ({
        getSnapshot: () => ({ nodes }),
        refresh: async () => {
          refreshCount += 1;
          nodes = input.nodesAfterRefresh ?? nodes;
          return true;
        },
      }),
      pullDocumentContent: (pull: { containerId: string; localId: string }) =>
        pulls.push(pull),
    } as unknown as ContainerContents,
    pulls,
    refreshCount: () => refreshCount,
  };
}

test("syncs the existing organization profile without another key mutation", async () => {
  const systemSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: ORGANIZATION_ID,
  });
  const harness = fakeContainerContents({
    initialNodes: [{ id: "metadata", systemSlot }],
  });

  await syncOrganizationMetadataProfile({
    containerContents: harness.contents,
    log: () => undefined,
    organizationId: ORGANIZATION_ID,
  });

  expect(harness.pulls).toEqual([
    {
      containerId: "metadata",
      localId: getOrganizationProfileDocumentLocalId({
        organizationId: ORGANIZATION_ID,
      }),
    },
  ]);
  expect(harness.refreshCount()).toBe(0);
});

test("hydrates the metadata slot before syncing", async () => {
  const systemSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: ORGANIZATION_ID,
  });
  const harness = fakeContainerContents({
    initialNodes: [{ id: "root" }],
    nodesAfterRefresh: [{ id: "metadata", systemSlot }],
  });

  await syncOrganizationMetadataProfile({
    containerContents: harness.contents,
    log: () => undefined,
    organizationId: ORGANIZATION_ID,
  });

  expect(harness.refreshCount()).toBe(1);
  expect(harness.pulls).toHaveLength(1);
});

test("logs and skips when metadata remains unreachable", async () => {
  const harness = fakeContainerContents({
    initialNodes: [{ id: "root" }],
  });
  const logs: string[] = [];

  await syncOrganizationMetadataProfile({
    containerContents: harness.contents,
    log: (message) => logs.push(message),
    organizationId: ORGANIZATION_ID,
  });

  expect(harness.pulls).toEqual([]);
  expect(logs[0]).toContain("not reachable");
});
