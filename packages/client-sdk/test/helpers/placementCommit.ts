import { createMockApiClient } from "@tearleads/test-utils";
import { createContainerContents } from "../../src/client/containerContents";
import { sqlDocumentContainerProjectionPersistence as links } from "../../src/data/persistence/container-contents/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence as documents } from "../../src/data/persistence/documents/documentsPersistence";
import { createRemoteHistoryFixture } from "../../src/stores/documents/documentStore/documentStore.testFixtures";
import { relinkDocumentStoreWithCommitSideEffect } from "../../src/stores/documents/documentStore/internalRelink";
import { persistFullHistoryDocument } from "../../src/stores/documents/documentStore/rotation/rotationRecoveryHelpers.test";
import { removeDocumentLinkLocally } from "../../src/workflows/container-contents/documentLinks/documentLinkIntent";
import { createFileBackedSql } from "./fileBackedSql";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "./internalRuntimeFixtures";

export async function createPlacementCommitFixture() {
  const db = await createFileBackedSql();
  await documents.ensureSchema(db.execSql);
  const fixture = await createRemoteHistoryFixture();
  const documentId = fixture.writerProjection.documentId;
  await persistFullHistoryDocument({
    doc: fixture.remoteDocument,
    documentId,
    execSql: db.execSql,
    localId: "local",
  });
  await links.replaceDocumentLinks(db.execSql, documentId, [
    "source-container",
    "other-container",
  ]);
  const workflow = createWorkflowInputFixture({
    execSql: db.execSql,
    apiClient: createMockApiClient(),
    online: false,
    containerId: "source-container",
  });
  const contents = createContainerContents(
    createInternalRuntimeFixture(() => workflow),
  );
  const documentLinks = contents.documentLinks();
  const store = documentLinks.openDocument({
    localId: "local",
    documentId,
    containerId: "source-container",
  });
  await store.ensureInitialized();
  const note = {
    id: "local",
    documentId,
    containerId: "source-container",
    title: "Placement",
    updatedAt: "2026-09-17T00:00:00.000Z",
  };
  const common = {
    mergeDocumentSummary: () => {},
    note,
    setLinkedContainerIdsForDocument: () => {},
    targetContainerId: "trash",
  };
  return {
    db,
    documentId,
    documentLinks,
    store,
    workflow,
    move: () =>
      documentLinks.moveDocumentToContainer({
        ...common,
        expandNode: () => {},
        replaceLinkedContainers: true,
      }),
    link: () => documentLinks.linkDocumentToContainer(common),
    // The local enqueue/commit below is downstream of unlink's rotation proof.
    // Keep the real store commit bridge; do not fake a transaction or a relink.
    unlink: () =>
      removeDocumentLinkLocally({
        ...common,
        removedContainerId: "source-container",
        runtime: documentLinks,
        currentDocumentStore: {
          ...store,
          relink: ({ commitSideEffect, ...input }) =>
            commitSideEffect
              ? relinkDocumentStoreWithCommitSideEffect(
                  store,
                  input,
                  commitSideEffect,
                )
              : store.relink(input),
        },
        host: {
          documentWorkflowRuntime: documentLinks.documentRuntime,
          mergeDocumentSummary: () => {},
          openDocumentStore: () => {
            throw new Error("Unexpected reopen");
          },
        },
      }),
  };
}
