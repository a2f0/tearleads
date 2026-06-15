import { expect, test } from "bun:test";
import {
  createContainerContentsStore,
  createContainerContentsWorkflowRuntime,
  createContainerDocumentObjectSyncState,
  defaultContainerContentsPersistence,
  defaultDocumentsPersistence,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { getVisibleExplorerNodes } from "./ExplorerProvider";

type ExplorerRuntime = Parameters<typeof createContainerContentsStore>[0];
type TestRuntime = ExplorerRuntime & { close: () => void };
type TestContainerRecord = Parameters<
  typeof defaultContainerContentsPersistence.saveContainer
>[1];

async function createSqlRuntime(): Promise<TestRuntime> {
  const runtimeBase = await createSqlRuntimeBase(
    "explorer-system-containers-test",
  );
  const runtime = createContainerContentsWorkflowRuntime({
    ...runtimeBase,
    apiClient: createMockApiClient(),
  });

  return {
    ...runtime,
    close: runtimeBase.close,
  };
}

async function ensureContainerTables(execSql: ExecSql): Promise<void> {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
}

async function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  await defaultDocumentsPersistence.ensureSchema(execSql);
}

async function loadContainers(
  execSql: ExecSql,
): Promise<ReadonlyArray<TestContainerRecord>> {
  const storedContainers =
    await defaultContainerContentsPersistence.loadContainers(execSql);
  return storedContainers.map(({ container }) => container);
}

async function saveContainer(
  execSql: ExecSql,
  container: TestContainerRecord,
): Promise<TestContainerRecord> {
  return defaultContainerContentsPersistence.saveContainer(
    execSql,
    container,
    null,
  );
}

test("explorer keeps one visible system container per slot", () => {
  const contactsSystemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const trashSystemSlot = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";

  expect(
    getVisibleExplorerNodes(
      [
        {
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "org-1",
          parentId: null,
          syncState: syncedContainerDocumentObjectSyncState,
        },
        {
          id: "contacts-local-container",
          kind: "container",
          name: "Contacts",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: createContainerDocumentObjectSyncState({
            localOnly: true,
          }),
          systemSlot: contactsSystemSlot,
        },
        {
          id: "contacts-remote-container",
          kind: "container",
          name: "Contacts",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: contactsSystemSlot,
        },
        {
          id: "trash-container",
          kind: "container",
          name: "Trash",
          organizationId: "org-1",
          parentId: "root-container",
          syncState: syncedContainerDocumentObjectSyncState,
          systemSlot: trashSystemSlot,
        },
      ],
      new Set([contactsSystemSlot, trashSystemSlot]),
    ).map((node) => node.id),
  ).toEqual(["root-container", "contacts-remote-container", "trash-container"]);
});

test("explorer store uses one local system container across stale store snapshots", async () => {
  const runtime = await createSqlRuntime();
  const systemSlot = "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  try {
    await ensureContainerTables(runtime.infra.execSql);
    await ensureDocumentTables(runtime.infra.execSql);
    await saveContainer(runtime.infra.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    const firstStore = createContainerContentsStore(runtime);
    const staleStore = createContainerContentsStore(runtime);
    firstStore.updateRuntime(runtime);
    staleStore.updateRuntime(runtime);
    await waitForCondition(
      () => firstStore.getSnapshot().ready && staleStore.getSnapshot().ready,
      "Explorer stores did not become ready.",
    );

    const firstSystemContainer = await firstStore.ensureSystemContainer(
      systemSlot,
      "Contacts",
    );
    const staleSystemContainer = await staleStore.ensureSystemContainer(
      systemSlot,
      "Contacts",
    );
    if (!firstSystemContainer || !staleSystemContainer) {
      throw new Error("Expected system container provisioning to succeed.");
    }

    expect(staleSystemContainer.id).toBe(firstSystemContainer.id);
    expect(firstSystemContainer.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(
      (await loadContainers(runtime.infra.execSql))
        .filter((container) => container.systemSlot === systemSlot)
        .map((container) => container.id),
    ).toEqual([firstSystemContainer.id]);
  } finally {
    runtime.close();
  }
});
