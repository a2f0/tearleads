import { expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
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
  syncState: syncedContainerDocumentObjectSyncState,
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

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
    setBackgroundActionError: () => undefined,
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

test("document move modal clears before the network mutation resolves", async () => {
  const moveDeferred = createDeferred<DocumentSummary | null>();
  const calls: string[] = [];

  await submitExplorerModalAction(
    createSubmitParams({
      clearModal: () => {
        calls.push("clear");
      },
      draftTargetContainerId: "target-container",
      modalState: { mode: "move-document", documentLocalId: "note-1" },
      moveDocument: () => moveDeferred.promise,
      setSelectedId: (id) => {
        calls.push(`select:${id}`);
      },
    }),
  );

  expect(calls).toEqual(["select:note-1", "clear"]);

  moveDeferred.resolve({
    accessStateHash: "access-state-hash",
    containerId: "target-container",
    documentId: "document-1",
    documentKind: "note",
    id: "note-1",
    title: "Moved note",
    updatedAt: "2026-06-20T00:00:00.000Z",
  });
  await moveDeferred.promise;
  await Promise.resolve();

  expect(calls).toEqual(["select:note-1", "clear"]);
});

test("delete modal clears before the container delete resolves", async () => {
  const deleteDeferred = createDeferred<boolean>();
  const calls: string[] = [];

  await submitExplorerModalAction(
    createSubmitParams({
      clearModal: () => {
        calls.push("clear");
      },
      deleteContainer: () => deleteDeferred.promise,
      modalState: { mode: "delete", nodeId: "container-1" },
      setSelectedId: (id) => {
        calls.push(`select:${id}`);
      },
    }),
  );

  expect(calls).toEqual(["select:root-container", "clear"]);

  deleteDeferred.resolve(true);
  await deleteDeferred.promise;
  await Promise.resolve();

  expect(calls).toEqual(["select:root-container", "clear"]);
});

test("background modal failures are surfaced after the modal closes", async () => {
  const deleteDeferred = createDeferred<boolean>();
  const backgroundErrors: Array<string | null> = [];
  const previousConsoleError = console.error;
  console.error = () => undefined;

  try {
    await submitExplorerModalAction(
      createSubmitParams({
        clearModal: () => undefined,
        deleteContainer: () => deleteDeferred.promise,
        modalState: { mode: "delete", nodeId: "container-1" },
        setBackgroundActionError: (error) => {
          backgroundErrors.push(error);
        },
      }),
    );

    expect(backgroundErrors).toEqual([]);

    deleteDeferred.resolve(false);
    await deleteDeferred.promise;
    await Promise.resolve();

    expect(backgroundErrors).toEqual(["Failed to delete container."]);
  } finally {
    console.error = previousConsoleError;
  }
});
