import { expect, test } from "bun:test";
import { syncedExplorerObjectSyncState } from "@tearleads/client-sdk/workflows/explorer";
import type { ContainerNode } from "../../../stores/explorer/types";
import {
  type ExplorerModalSubmitParams,
  submitExplorerModalAction,
} from "./actions";

const containerNode: ContainerNode = {
  id: "container-1",
  kind: "container",
  name: "Container",
  organizationId: "organization-1",
  parentId: "root-container",
  syncState: syncedExplorerObjectSyncState,
};

function createSubmitParams(
  overrides: Partial<ExplorerModalSubmitParams>,
): ExplorerModalSubmitParams {
  return {
    clearModal: () => undefined,
    createChild: async () => null,
    deleteContainer: async () => false,
    draftName: "",
    draftTargetContainerId: "",
    expandNode: () => undefined,
    linkDocument: async () => null,
    modalState: null,
    moveContainer: async () => null,
    moveDocument: async () => null,
    nodes: [containerNode],
    peerUserId: null,
    renameContainer: async () => null,
    setModalError: () => undefined,
    setSelectedId: () => undefined,
    shareWithUser: async () => false,
    ...overrides,
  };
}

test("name modal actions trim container names before submission", async () => {
  const submittedCreates: string[] = [];
  const submittedRenames: string[] = [];

  await submitExplorerModalAction(
    createSubmitParams({
      createChild: async (_parentId, name) => {
        submittedCreates.push(name);
        return containerNode;
      },
      draftName: "  Child container  ",
      modalState: { mode: "create-child", nodeId: "container-1" },
    }),
  );

  await submitExplorerModalAction(
    createSubmitParams({
      draftName: "\tRenamed container\n",
      modalState: { mode: "rename", nodeId: "container-1" },
      renameContainer: async (_containerId, name) => {
        submittedRenames.push(name);
        return containerNode;
      },
    }),
  );

  expect(submittedCreates).toEqual(["Child container"]);
  expect(submittedRenames).toEqual(["Renamed container"]);
});
