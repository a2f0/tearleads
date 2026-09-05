import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../test/helpers/internalRuntimeFixtures";
import { waitFor } from "../../test/helpers/waitFor";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";
import { defaultContainerContentsPersistence } from "../workflows/container-contents/containerPersistence";
import type { ContainerContents } from "./containerContents";
import {
  createDeviceFirst,
  createDeviceFirstWorkflowRuntime,
} from "./deviceFirst";
import { createDocuments } from "./documents";

test("offline edits update the device-first view and survive reopening without API calls", async () => {
  const { close, execSql } = await createTestExecSql(
    "device-first-offline-edits",
  );
  const calls: string[] = [];
  const apiClient = new Proxy(createMockApiClient(), {
    get: (_target, key) => async () => {
      calls.push(String(key));
      throw new Error("No network is available");
    },
  });
  const workflowInput = createWorkflowInputFixture({
    apiClient,
    auth: { isAuthenticated: true },
    blobStore: createMemoryBlobStore(),
    containerId: "root",
    execSql,
    online: false,
  });
  const runtime = createInternalRuntimeFixture(() => workflowInput);
  const deviceFirst = createDeviceFirst(runtime, {} as ContainerContents);
  const documents = createDocuments({
    getDefaultContainerId: () => "root",
    runtime,
  });

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        effectiveAccessLevel: "admin",
        icon: null,
        id: "root",
        metadataDocumentId: null,
        name: "/",
        organizationId: "org",
        parentId: null,
      },
      null,
    );
    const { containerStore, view } = deviceFirst.open();
    view.updateRuntime(createDeviceFirstWorkflowRuntime(runtime));
    await waitFor(() => view.getSnapshot().ready, "Local tree did not hydrate");
    view.setActiveContainer("root");
    await waitFor(
      () => view.getSnapshot().documentSummariesByContainerId.has("root"),
      "Local list did not hydrate",
    );
    const titles = (id: string) =>
      view
        .getSnapshot()
        .documentSummariesByContainerId.get(id)
        ?.map((summary) => summary.title);

    const folder = await containerStore.createChild("root", "Offline folder");
    expect(folder).not.toBeNull();
    if (!folder) throw new Error("Missing local folder");
    await containerStore.renameContainer(folder.id, "Renamed offline");
    expect(
      view.getSnapshot().containers.find((node) => node.id === folder.id)?.name,
    ).toBe("Renamed offline");

    const note = documents.open({ localId: "offline-note" });
    await note.setText("Created offline");
    await waitFor(
      () => titles("root")?.includes("Created offline") === true,
      "Local creation never reached the view",
    );
    await note.setText("Edited offline");
    await waitFor(
      () => titles("root")?.includes("Edited offline") === true,
      "Local edit never reached the view",
    );

    view.setActiveContainer(folder.id);
    await waitFor(
      () => titles(folder.id)?.length === 0,
      "Folder did not hydrate",
    );
    await note.relink({
      accessEpoch: 1,
      containerId: folder.id,
      documentId: null,
      localId: "offline-note",
    });
    await waitFor(
      () =>
        titles(folder.id)?.includes("Edited offline") === true &&
        titles("root")?.length === 0,
      "Local move did not update both cached lists",
    );
    view.setActiveContainer("root");
    view.setActiveContainer(folder.id);
    expect(view.getSnapshot().ready).toBe(true);

    // Use a fresh domain scope over the same SQLite and blob adapters, as on a
    // process restart. Pending document content must not need a remote pull.
    const reopenedInput = createWorkflowInputFixture({
      apiClient,
      auth: workflowInput.auth,
      blobStore: workflowInput.infra.blobStore,
      containerId: folder.id,
      execSql,
      online: false,
    });
    const reopenedRuntime = createInternalRuntimeFixture(() => reopenedInput);
    const reopenedDocuments = createDocuments({
      getDefaultContainerId: () => folder.id,
      runtime: reopenedRuntime,
    });
    const reopenedNote = reopenedDocuments.open({ localId: "offline-note" });
    await reopenedNote.ensureInitialized();
    expect(reopenedNote.getSnapshot().text).toBe("Edited offline");
    expect((await reopenedDocuments.list())?.rows[0]?.containerId).toBe(
      folder.id,
    );
    await documents.delete("offline-note");
    await waitFor(
      () => titles(folder.id)?.length === 0,
      "Local deletion did not reach the view",
    );
    expect(calls).toEqual([]);
  } finally {
    deviceFirst.dispose();
    close();
  }
});
