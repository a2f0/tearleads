import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { useExplorerPrimaryOrganizationId } from "./useExplorerPrimaryOrganizationId";

afterEach(cleanup);

function rootNode(id: string, organizationId: string): ContainerNode {
  return {
    id,
    kind: "container",
    name: id,
    organizationId,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  };
}

test("the explicit default organization is primary while a custom org is active", () => {
  const appData = {
    auth: {
      defaultOrganizationId: "personal-org",
      isAuthenticated: true,
      organizationId: "custom-org",
    },
    infra: { dbStatus: "ready" },
    state: { containerId: "custom-root" },
  } as RuntimeSnapshot;
  const nodes = [
    rootNode("custom-root", "custom-org"),
    rootNode("personal-root", "personal-org"),
  ];
  const view = renderHook(() =>
    useExplorerPrimaryOrganizationId({
      appData,
      nodes,
    }),
  );

  expect(view.result.current).toBe("personal-org");
});
