import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/data/waitFor";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/workflows/internalRuntimeFixtures";
import type { BlobStore } from "../../data/blobs/blobContracts";
import { createDomainScope } from "../../data/shared/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  ContainerSyncWatermarkRepository,
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStoreWorkflowRuntimeFromSnapshot } from "../../workflows/container-contents/runtime";
import { defaultDocumentsPersistence } from "../../workflows/documents";
import { containerContentsOrganizationHost } from "../../workflows/organizations/containerContentsHost";
import type { ContainerContents } from "../containerContents";
import { createDocuments } from "../documents";
import { createDeviceFirst, createDeviceFirstWorkflowRuntime } from "./index";

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
  await new ContainerSyncWatermarkRepository(execSql).markChecked(
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
  const runtime = createContainerContentsStoreWorkflowRuntimeFromSnapshot(
    { ...workflowInput, organizations: containerContentsOrganizationHost },
    adoptRootContainer,
    async () => undefined,
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
      contentSha256: "0".repeat(64),
      byteLength: 1,
      localId: "note-1",
      mimeType: "text/plain",
      name: "queued.txt",
      slotId: "queued-slot",
      storageKey: "queued-storage",
    });
    const view = deviceFirst.open().view;
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

test("late summary reads stay with their device-first lifetime", async () => {
  const { execSql, close } = await createTestExecSql(
    "device-first-late-summary",
  );
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const guardedSql = new Proxy(execSql, {
    apply: async (target, _, args: Parameters<ExecSql>) => {
      const rows = await target(...args);
      if (
        args[0].startsWith("select") &&
        args[0].includes('from "document_projection"')
      ) {
        entered.resolve();
        await release.promise;
      }
      return rows;
    },
  });
  const input = createWorkflowInputFixture({
    apiClient: createMockApiClient(),
    domainScope: createDomainScope(),
    auth: { isAuthenticated: false },
    containerId: CONTAINER_ID,
    execSql: guardedSql,
    online: false,
  });
  const runtime = createInternalRuntimeFixture(() => input);
  const service = createDeviceFirst(runtime, {} as ContainerContents);
  try {
    await seedCachedDocuments(execSql);
    const old = service.open().view;
    old.updateRuntime(createDeviceFirstWorkflowRuntime(runtime));
    await waitFor(() => old.getSnapshot().ready, "original view");
    old.setActiveContainer(CONTAINER_ID);
    await entered.promise;
    service.dispose();
    const reopened = service.open().view;
    reopened.updateRuntime(createDeviceFirstWorkflowRuntime(runtime));
    reopened.setActiveContainer(CONTAINER_ID);
    release.resolve();
    await waitFor(
      () =>
        reopened.getSnapshot().documentSummariesByContainerId.get(CONTAINER_ID)
          ?.length === 2,
      "replacement summaries",
    );
    expect(
      old.getSnapshot().documentSummariesByContainerId.get(CONTAINER_ID),
    ).toBeUndefined();
  } finally {
    release.resolve();
    service.dispose();
    await close();
  }
});
