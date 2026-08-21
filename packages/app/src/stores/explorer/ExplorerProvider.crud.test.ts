import { expect, test } from "bun:test";
import {
  createContainerDocumentObjectSyncState,
  createContainerContentsStore as createExplorerStore,
} from "@symcrypt/client-sdk";
import {
  createContainerParentLaneBatchMock,
  createMockApiClient,
} from "@symcrypt/test-utils";
import {
  ensureContainerTables,
  ensureDocumentTables,
  listContainersResponse,
  loadContainers,
  saveContainer,
} from "../../../test/helpers/explorer-provider/explorerProviderFixtures";
import {
  createSqlRuntime,
  runtimeWithPatch,
} from "../../../test/helpers/explorer-provider/explorerProviderHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";

test("explorer store creates, renames, deletes, and reloads child containers", async () => {
  const runtime = await createSqlRuntime();

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      effectiveAccessLevel: "admin",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    const firstStore = createExplorerStore(runtime);
    firstStore.updateRuntime(runtime);

    await waitForCondition(
      () => firstStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    expect(firstStore.getSnapshot()).toEqual({
      nodes: [
        {
          createdAt: expect.any(String),
          effectiveAccessLevel: "admin",
          id: "root-container",
          kind: "container",
          metadataDocumentId: null,
          name: "/",
          organizationId: "org-1",
          parentId: null,
          syncState: createContainerDocumentObjectSyncState({
            localOnly: true,
            pendingUpdateCount: 1,
          }),
          updatedAt: expect.any(String),
        },
      ],
      ready: true,
    });

    const childNode = await firstStore.createChild("root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    expect(childNode.name).toBe("Docs");
    expect(childNode.organizationId).toBe("org-1");
    expect(childNode.parentId).toBe("root-container");
    expect(childNode.createdAt).toEqual(expect.any(String));
    expect(childNode.updatedAt).toEqual(expect.any(String));
    expect(firstStore.getSnapshot().nodes).toHaveLength(2);
    expect(
      firstStore
        .getSnapshot()
        .nodes.some(
          (node) =>
            node.id === childNode.id &&
            node.parentId === "root-container" &&
            node.createdAt === childNode.createdAt &&
            node.updatedAt === childNode.updatedAt,
        ),
    ).toBe(true);

    const renamedNode = await firstStore.renameContainer(
      childNode.id,
      "Manuals",
    );
    if (!renamedNode) {
      throw new Error("Expected renameContainer to return the renamed node.");
    }

    expect(renamedNode.id).toBe(childNode.id);
    expect(renamedNode.name).toBe("Manuals");
    expect(
      firstStore
        .getSnapshot()
        .nodes.some(
          (node) => node.id === childNode.id && node.name === "Manuals",
        ),
    ).toBe(true);

    const deletedRoot = await firstStore.deleteContainer("root-container");
    expect(deletedRoot).toBe(false);

    const deletedChild = await firstStore.deleteContainer(childNode.id);
    expect(deletedChild).toBe(true);
    expect(firstStore.getSnapshot().nodes).toHaveLength(1);
    expect(
      firstStore.getSnapshot().nodes.some((node) => node.id === childNode.id),
    ).toBe(false);

    const secondStore = createExplorerStore(runtime);
    secondStore.updateRuntime(runtime);

    await waitForCondition(
      () => secondStore.getSnapshot().ready,
      "Reloaded explorer store did not become ready.",
    );

    expect(secondStore.getSnapshot().nodes).toHaveLength(1);
    expect(
      secondStore.getSnapshot().nodes.some((node) => node.id === childNode.id),
    ).toBe(false);
  } finally {
    runtime.close();
  }
});

test("explorer store moves a folder into a system-slot (Trash) container", async () => {
  const runtime = await createSqlRuntime();

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      effectiveAccessLevel: "admin",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.infra.execSql, {
      id: "trash-container",
      effectiveAccessLevel: "admin",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: null,
      name: "Trash",
      icon: "trash",
      systemSlot: "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    await saveContainer(runtime.infra.execSql, {
      id: "user-folder",
      effectiveAccessLevel: "admin",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: null,
      name: "Folder",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    // A normal folder can be re-parented under the Trash system container — this
    // is what backs the "Move to Trash" folder action. The move op guards only
    // the MOVED container's system slot, not the destination's.
    const moved = await store.moveContainer("user-folder", "trash-container");
    expect(moved?.parentId).toBe("trash-container");
    expect(
      store.getSnapshot().nodes.find((node) => node.id === "user-folder")
        ?.parentId,
    ).toBe("trash-container");

    // The Trash system container itself cannot be moved (systemSlot guard).
    const movedSystem = await store.moveContainer(
      "trash-container",
      "user-folder",
    );
    expect(movedSystem).toBeNull();
  } finally {
    runtime.close();
  }
});

test("explorer store deletes remote leaf containers through the API", async () => {
  let runtime = await createSqlRuntime();
  const deletedContainerIds: string[] = [];

  try {
    runtime = runtimeWithPatch(runtime, {
      apiClient: createMockApiClient({
        deleteContainer: async (containerId: string) => {
          deletedContainerIds.push(containerId);
          return {
            containerId,
            deletedAt: "2026-05-06T18:00:00.000Z",
          };
        },
        listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
          listContainersResponse(),
        ),
      }),
      isAuthenticated: true,
      online: true,
    });

    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.infra.execSql, {
      id: "remote-child",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "remote-child-metadata-document",
      name: "Remote",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const deleted = await store.deleteContainer("remote-child");
    expect(deleted).toBe(true);
    expect(deletedContainerIds).toEqual(["remote-child"]);
    expect(
      store.getSnapshot().nodes.some((node) => node.id === "remote-child"),
    ).toBe(false);

    const remainingContainers = await loadContainers(runtime.infra.execSql);
    expect(remainingContainers.map((container) => container.id)).toEqual([
      "root-container",
    ]);
  } finally {
    runtime.close();
  }
});

test("explorer store keeps remote containers local when API delete fails", async () => {
  let runtime = await createSqlRuntime();

  try {
    runtime = runtimeWithPatch(runtime, {
      apiClient: createMockApiClient({
        deleteContainer: async () => null,
        listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
          listContainersResponse(),
        ),
      }),
      isAuthenticated: true,
      online: true,
    });

    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.infra.execSql, {
      id: "remote-child",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "remote-child-metadata-document",
      name: "Remote",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const deleted = await store.deleteContainer("remote-child");
    expect(deleted).toBe(false);
    expect(
      store.getSnapshot().nodes.some((node) => node.id === "remote-child"),
    ).toBe(true);
  } finally {
    runtime.close();
  }
});

test("explorer store removes local remote containers when API delete returns 404", async () => {
  let runtime = await createSqlRuntime();
  const deletedContainerIds: string[] = [];

  try {
    runtime = runtimeWithPatch(runtime, {
      apiClient: createMockApiClient({
        deleteContainerResult: async (containerId: string) => {
          deletedContainerIds.push(containerId);
          return {
            kind: "http",
            message: `DELETE /containers/${containerId}: 404 Not Found`,
            method: "DELETE",
            ok: false,
            path: `/containers/${containerId}`,
            report: () => {},
            status: 404,
            statusText: "Not Found",
          };
        },
        listContainerParentLanes: createContainerParentLaneBatchMock(async () =>
          listContainersResponse(),
        ),
      }),
      isAuthenticated: true,
      online: true,
    });

    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.infra.execSql, {
      id: "remote-child",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "remote-child-metadata-document",
      name: "Remote",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const deleted = await store.deleteContainer("remote-child");
    expect(deleted).toBe(true);
    expect(deletedContainerIds).toEqual(["remote-child"]);
    expect(
      store.getSnapshot().nodes.some((node) => node.id === "remote-child"),
    ).toBe(false);

    const remainingContainers = await loadContainers(runtime.infra.execSql);
    expect(remainingContainers.map((container) => container.id)).toEqual([
      "root-container",
    ]);
  } finally {
    runtime.close();
  }
});
