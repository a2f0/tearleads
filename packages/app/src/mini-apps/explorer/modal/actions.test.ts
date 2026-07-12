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
    purgeContainer: async () => false,
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

test("purge modal clears before the container purge resolves and navigates to the parent", async () => {
  const purgeDeferred = createDeferred<boolean>();
  const calls: string[] = [];

  await submitExplorerModalAction(
    createSubmitParams({
      clearModal: () => {
        calls.push("clear");
      },
      modalState: { mode: "purge", nodeId: "container-1" },
      purgeContainer: () => purgeDeferred.promise,
      setSelectedId: (id) => {
        calls.push(`select:${id}`);
      },
    }),
  );

  expect(calls).toEqual(["select:root-container", "clear"]);

  purgeDeferred.resolve(true);
  await purgeDeferred.promise;
  await Promise.resolve();

  expect(calls).toEqual(["select:root-container", "clear"]);
});

test("purge modal surfaces a background failure after closing", async () => {
  const purgeDeferred = createDeferred<boolean>();
  const backgroundErrors: Array<string | null> = [];
  const previousConsoleError = console.error;
  console.error = () => undefined;

  try {
    await submitExplorerModalAction(
      createSubmitParams({
        clearModal: () => undefined,
        modalState: { mode: "purge", nodeId: "container-1" },
        purgeContainer: () => purgeDeferred.promise,
        setBackgroundActionError: (error) => {
          backgroundErrors.push(error);
        },
      }),
    );

    expect(backgroundErrors).toEqual([]);

    purgeDeferred.resolve(false);
    await purgeDeferred.promise;
    await Promise.resolve();

    expect(backgroundErrors).toEqual(["Failed to delete container forever."]);
  } finally {
    console.error = previousConsoleError;
  }
});

test("purge modal refuses to permanently delete while offline", async () => {
  const backgroundErrors: Array<string | null> = [];
  let purgeAttempts = 0;

  await submitExplorerModalAction(
    createSubmitParams({
      modalState: { mode: "purge", nodeId: "container-1" },
      online: false,
      purgeContainer: async () => {
        purgeAttempts += 1;
        return true;
      },
      setBackgroundActionError: (error) => {
        backgroundErrors.push(error);
      },
    }),
  );

  // Offline permanent-delete short-circuits with a clear message and never
  // attempts the remote-first purge (there is no offline delete outbox).
  expect(purgeAttempts).toBe(0);
  expect(backgroundErrors).toEqual([
    "You must be online to permanently delete this folder.",
  ]);
});
