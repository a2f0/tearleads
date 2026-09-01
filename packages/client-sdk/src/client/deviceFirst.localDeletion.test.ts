import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../test/helpers/internalRuntimeFixtures";
import { waitFor } from "../../test/helpers/waitFor";
import type { BlobStore } from "../data/blobContracts";
import { createDomainScope } from "../data/domainScope";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
  markContainerSyncLaneChecked,
} from "../workflows/container-contents/containerPersistence";
import { createContainerContentsStoreWorkflowRuntime } from "../workflows/container-contents/runtime";
import { defaultDocumentsPersistence } from "../workflows/documents";
import type { ContainerContents } from "./containerContents";
import {
  createDeviceFirst,
  createDeviceFirstWorkflowRuntime,
} from "./deviceFirst";
import { createDocuments } from "./documents";

const CONTAINER_ID = "cached-root";

async function seedCachedDocuments(execSql: ExecSql): Promise<void> {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "admin",
      icon: null,
      id: CONTAINER_ID,
      metadataDocumentId: null,
      name: "/",
      organizationId: "org-1",
      parentId: null,
    },
    null,
  );
  await markContainerSyncLaneChecked(
    execSql,
    createContainerParentSyncLane(null),
  );

  await defaultDocumentsPersistence.ensureSchema(execSql);
  for (const [id, title] of [
    ["note-1", "First note"],
    ["note-2", "Second note"],
  ] as const) {
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: CONTAINER_ID,
      contentKeyBundle: null,
      documentId: null,
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id,
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: title,
      title,
    });
  }
}

test("local deletion evicts a cached device-first summary until disposal", async () => {
  const { close, execSql } = await createTestExecSql(
    "device-first-local-deletion-test",
  );
  const domainScope = createDomainScope();
  const apiClient = createMockApiClient();
  const deletedStorageKeys: string[] = [];
  const blobStore = {
    deleteBytes: async (storageKey: string) => {
      deletedStorageKeys.push(storageKey);
    },
    openByteSource: async () => null,
    readBytes: async () => null,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
  } satisfies BlobStore;
  const workflowInput = createWorkflowInputFixture({
    apiClient,
    auth: { isAuthenticated: false },
    blobStore,
    containerId: CONTAINER_ID,
    domainScope,
    execSql,
    online: false,
  });
  const adoptRootContainer = () => false;
  const runtime = createContainerContentsStoreWorkflowRuntime(
    workflowInput,
    adoptRootContainer,
  );
  const runtimeService = createInternalRuntimeFixture(() => workflowInput, {
    adoptRootContainer,
  });
  expect(
    createDeviceFirstWorkflowRuntime(runtimeService).adoptRootContainer,
  ).toBe(adoptRootContainer);
  const deviceFirst = createDeviceFirst(
    runtimeService,
    {} as ContainerContents,
  );
  const documents = createDocuments({
    getDefaultContainerId: () => CONTAINER_ID,
    runtime: runtimeService,
  });

  try {
    await seedCachedDocuments(execSql);
    await defaultDocumentsPersistence.savePendingAttachment(execSql, {
      byteLength: 1,
      localId: "note-1",
      mimeType: "text/plain",
      name: "queued.txt",
      slotId: "queued-slot",
      storageKey: "queued-storage",
    });
    const view = deviceFirst.openView();
    view.updateRuntime(runtime);
    await waitFor(
      () => view.getSnapshot().ready,
      "Device-first view did not hydrate.",
    );
    view.setActiveContainer(CONTAINER_ID);
    await waitFor(
      () =>
        view.getSnapshot().documentSummariesByContainerId.get(CONTAINER_ID)
          ?.length === 2,
      "Device-first summaries did not hydrate.",
    );

    let notifications = 0;
    view.subscribe(() => {
      notifications += 1;
    });
    await expect(documents.delete("note-1")).resolves.toBe(true);
    await waitFor(
      () => deletedStorageKeys.includes("queued-storage"),
      "Document deletion did not wake orphan blob reclamation.",
    );
    expect(
      view
        .getSnapshot()
        .documentSummariesByContainerId.get(CONTAINER_ID)
        ?.map((summary) => summary.id),
    ).toEqual(["note-2"]);
    expect(notifications).toBe(1);

    deviceFirst.dispose();
    notifications = 0;
    await expect(documents.delete("note-2")).resolves.toBe(true);
    expect(notifications).toBe(0);
    expect(
      view
        .getSnapshot()
        .documentSummariesByContainerId.get(CONTAINER_ID)
        ?.map((summary) => summary.id),
    ).toEqual(["note-2"]);
  } finally {
    deviceFirst.dispose();
    close();
  }
});
