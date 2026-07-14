import { afterEach, expect, mock, test } from "bun:test";
import type { ContainerNode, Tearleads } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
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

test("retains the personal organization through a transient unready snapshot", async () => {
  const listLocalOrganizations = mock(async () => [
    {
      name: "Personal Org",
      organizationId: "personal-org",
      rootContainerId: "personal-root",
    },
  ]);
  const tearleads = {
    organizations: { listLocalOrganizations },
  } as unknown as Tearleads;
  const appData = {
    auth: {
      isAuthenticated: true,
      organizationId: "custom-org",
    },
    infra: { dbStatus: "ready" },
    state: { containerId: "custom-root" },
  } as RuntimeSnapshot;
  const nodes = [
    rootNode("personal-root", "personal-org"),
    rootNode("custom-root", "custom-org"),
  ];
  const view = renderHook(
    ({ ready }) =>
      useExplorerPrimaryOrganizationId({
        appData,
        nodes,
        ready,
        tearleads,
      }),
    { initialProps: { ready: true } },
  );

  await waitFor(() => expect(view.result.current).toBe("personal-org"));
  view.rerender({ ready: false });
  await waitFor(() => expect(view.result.current).toBe("personal-org"));
  expect(listLocalOrganizations).toHaveBeenCalledTimes(1);
});

test("keeps the explicit default organization primary when the local index lists a foreign org first", () => {
  const listLocalOrganizations = mock(async () => [
    {
      name: "Foreign Org",
      organizationId: "custom-org",
      rootContainerId: "custom-root",
    },
    {
      name: "Personal Org",
      organizationId: "personal-org",
      rootContainerId: "personal-root",
    },
  ]);
  const tearleads = {
    organizations: { listLocalOrganizations },
  } as unknown as Tearleads;
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
      ready: true,
      tearleads,
    }),
  );

  expect(view.result.current).toBe("personal-org");
  expect(listLocalOrganizations).toHaveBeenCalledTimes(0);
});
