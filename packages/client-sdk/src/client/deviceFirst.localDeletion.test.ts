import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { BlobStore } from "../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../data/documents/documentKinds";
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
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

const CONTAINER_ID = "cached-root";

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

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
  const workflowInput = {
    apiClient,
    resolveTrustedUserIdentity: async () => null,
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    state: {
      containerId: CONTAINER_ID,
      domainScope,
      events: [],
      online: false,
    },
    util: {
      log: () => {},
      logError: () => {},
    },
  } satisfies InternalWorkflowRuntimeInput;
  const adoptRootContainer = () => false;
  const runtime = createContainerContentsStoreWorkflowRuntime(
    workflowInput,
    adoptRootContainer,
  );
  const runtimeService = {
    adoptRootContainer,
    pinLocalUserIdentity: async () => {},
    publicRuntime: {
      version: 0,
      input: () => workflowInput,
      subscribe: () => () => {},
    },
    workflowInput: () => workflowInput,
  } satisfies InternalRuntime;
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
