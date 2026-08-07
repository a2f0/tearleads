import { afterEach, expect, mock, test } from "bun:test";
import {
  type ContainerContentsStore,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { ExplorerContext, useExplorer } from "./ExplorerProvider";

afterEach(() => cleanup());

const trashSystemSlot = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";
const hiddenSystemSlot = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("explorer context preserves its exact surface and projected nodes", async () => {
  const refresh = mock(async () => true);
  const unused = mock(async () => undefined);
  const root = {
    id: "root",
    kind: "container" as const,
    name: "/",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  };
  const trash = {
    ...root,
    id: "trash",
    name: "Trash",
    parentId: "root",
    systemSlot: trashSystemSlot,
  };
  const hidden = {
    ...trash,
    id: "hidden",
    name: "Roster Profiles",
    systemSlot: hiddenSystemSlot,
  };
  const snapshot = { nodes: [root, trash, hidden], ready: true };
  const store = {
    createChild: unused,
    deleteContainer: unused,
    emptyTrash: unused,
    ensureSystemContainer: unused,
    getSnapshot: () => snapshot,
    moveContainer: unused,
    purgeContainer: unused,
    refresh,
    refreshRootLane: unused,
    renameContainer: unused,
    requestSync: unused,
    setContainerIcon: unused,
    shareWithGroup: unused,
    shareWithUser: unused,
    subscribe: () => () => undefined,
  } as unknown as ContainerContentsStore;
  function ExplorerTestProvider({ children }: PropsWithChildren) {
    return (
      <ExplorerContext.Provider
        value={{
          builtInSystemContainers: [],
          contactsSystemSlot: null,
          currentOrganizationId: "org-1",
          currentRootContainerId: "root",
          logError: () => undefined,
          reconciler: {} as never,
          store,
          trashSystemSlot,
          view: {} as never,
          visibleSystemSlots: new Set([trashSystemSlot]),
        }}
      >
        {children}
      </ExplorerContext.Provider>
    );
  }
  const view = renderHook(() => useExplorer(), {
    wrapper: ExplorerTestProvider,
  });

  expect(Object.keys(view.result.current).sort()).toEqual(
    [
      "builtInSystemContainers",
      "canResolveTrashContainer",
      "contactsSystemSlot",
      "createChild",
      "deleteContainer",
      "emptyTrash",
      "ensureSystemContainer",
      "ensureTrashContainer",
      "moveContainer",
      "nodes",
      "purgeContainer",
      "ready",
      "reconciler",
      "refresh",
      "refreshRootLane",
      "renameContainer",
      "requestSync",
      "setContainerIcon",
      "shareWithGroup",
      "shareWithUser",
      "trashContainerId",
      "trashSystemSlot",
      "view",
      "visibleSystemSlots",
    ].sort(),
  );
  expect(view.result.current.refresh).toBe(refresh);
  expect(view.result.current.nodes.map((node) => node.id)).toEqual([
    "root",
    "trash",
  ]);
  expect(view.result.current.trashContainerId).toBe("trash");
  expect(await view.result.current.ensureTrashContainer()).toBe(trash);
});
