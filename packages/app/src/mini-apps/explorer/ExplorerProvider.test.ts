import { expect, test } from "bun:test";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/containerPersistence";
import { createExplorerStore } from "./ExplorerProvider";

type ExplorerRuntime = Parameters<typeof createExplorerStore>[0];
type TestRuntime = ExplorerRuntime & { close: () => void };

async function createSqlRuntime(): Promise<TestRuntime> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = Bun.fetch;

  let db: Awaited<ReturnType<typeof initDatabase>>;
  try {
    db = await initDatabase({
      dbName: `/${crypto.randomUUID()}.db`,
      cipher: "chacha20",
      key: "explorer-provider-test",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  return {
    apiClient: {
      createContainer: async (_id: string, _parentId: string) => null,
    },
    close: () => db.close(),
    dbStatus: "ready" as const,
    domainScope: {},
    execSql: async (
      sql: string,
      bind?: Record<string, string | number | null>,
    ) => execDatabaseStatement(db, bind ? { bind, sql } : { sql }),
    isAuthenticated: false,
    log: () => {},
  };
}

test("explorer store creates, renames, deletes, and reloads child containers", async () => {
  const runtime = await createSqlRuntime();

  try {
    await ensureContainerTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      name: "/",
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
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "org-1",
          parentId: null,
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
    expect(firstStore.getSnapshot().nodes).toHaveLength(2);
    expect(
      firstStore
        .getSnapshot()
        .nodes.some(
          (node) =>
            node.id === childNode.id && node.parentId === "root-container",
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

test("explorer store creates authenticated child containers through the API before persisting locally", async () => {
  const runtime = await createSqlRuntime();
  const createContainerCalls: Array<{
    id: string;
    parentId: string;
  }> = [];

  runtime.isAuthenticated = true;
  runtime.apiClient = {
    createContainer: async (id: string, parentId: string) => {
      createContainerCalls.push({ id, parentId });
      return {
        id,
        organizationId: "org-1",
        parentId,
      };
    },
  };

  try {
    await ensureContainerTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      name: "/",
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const childNode = await store.createChild("root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    expect(createContainerCalls).toEqual([
      {
        id: childNode.id,
        parentId: "root-container",
      },
    ]);

    const persistedRows = await runtime.execSql(
      `
        SELECT id, organization_id, parent_id, name
        FROM containers
        WHERE id = :id
      `,
      { ":id": childNode.id },
    );

    expect(persistedRows).toHaveLength(1);
    expect(childNode.organizationId).toBe("org-1");
    expect(childNode.parentId).toBe("root-container");
  } finally {
    runtime.close();
  }
});
