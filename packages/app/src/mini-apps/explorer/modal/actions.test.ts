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
    draftName: "",
    draftTargetContainerId: "",
    expandNode: () => undefined,
    linkDocument: async () => null,
    canShareWithPeer: true,
    modalState: null,
    moveContainer: async () => null,
    moveDocument: async () => null,
    nodes: [containerNode],
    online: true,
    peerUserId: null,
    startContainerPurge: () => undefined,
    startEmptyTrash: () => undefined,
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

test("purge modal navigates to the parent, hands off to the purge run, and closes", async () => {
  const calls: string[] = [];

  await submitExplorerModalAction(
    createSubmitParams({
      clearModal: () => {
        calls.push("clear");
      },
      modalState: { mode: "purge", nodeId: "container-1" },
      setSelectedId: (id) => {
        calls.push(`select:${id}`);
      },
      startContainerPurge: (containerId) => {
        calls.push(`purge:${containerId}`);
      },
    }),
  );

  // The confirm modal re-selects the parent, kicks off the long-running purge
  // run (which owns the progress + cancel modal), then closes — it no longer
  // awaits the purge itself.
  expect(calls).toEqual([
    "select:root-container",
    "purge:container-1",
    "clear",
  ]);
});

test("purge modal refuses to permanently delete while offline", async () => {
  const backgroundErrors: Array<string | null> = [];
  let purgeStarts = 0;

  await submitExplorerModalAction(
    createSubmitParams({
      modalState: { mode: "purge", nodeId: "container-1" },
      online: false,
      setBackgroundActionError: (error) => {
        backgroundErrors.push(error);
      },
      startContainerPurge: () => {
        purgeStarts += 1;
      },
    }),
  );

  // Offline permanent-delete short-circuits with a clear message and never
  // starts the purge run (there is no offline delete outbox).
  expect(purgeStarts).toBe(0);
  expect(backgroundErrors).toEqual([
    "You must be online to permanently delete this folder.",
  ]);
});

test("empty-trash modal hands off to the empty-trash run and closes", async () => {
  const calls: string[] = [];

  await submitExplorerModalAction(
    createSubmitParams({
      clearModal: () => {
        calls.push("clear");
      },
      modalState: { mode: "empty-trash", nodeId: "trash-container" },
      startEmptyTrash: (trashContainerId) => {
        calls.push(`empty:${trashContainerId}`);
      },
    }),
  );

  expect(calls).toEqual(["empty:trash-container", "clear"]);
});

test("empty-trash modal refuses while offline", async () => {
  const backgroundErrors: Array<string | null> = [];
  let emptyStarts = 0;

  await submitExplorerModalAction(
    createSubmitParams({
      modalState: { mode: "empty-trash", nodeId: "trash-container" },
      online: false,
      setBackgroundActionError: (error) => {
        backgroundErrors.push(error);
      },
      startEmptyTrash: () => {
        emptyStarts += 1;
      },
    }),
  );

  expect(emptyStarts).toBe(0);
  expect(backgroundErrors).toEqual(["You must be online to empty the Trash."]);
});
