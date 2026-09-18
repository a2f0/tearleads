import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence as documents } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../../stores/documents/documentStore/documentStore.testFixtures";
import {
  ensureDocumentStoreReady,
  relinkDocumentStore,
} from "../../stores/documents/documentStore/initialization";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../stores/documents/documentStore/rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "../../stores/documents/documentStore/state";
import { moveRemoteDocumentLinkLocally } from "./documentMoveIntent";
import type {
  DocumentStructuralMutationLocalStore,
  DocumentStructuralMutationRuntime,
} from "./documentStructureTypes";

test.each([false, true])(
  "local move commits document, links and intent together (projection fails: %s)",
  async (failProjection) => {
    const db = await createTestExecSql(`move-commit-${failProjection}`);
    let armed = false;
    const execSql: ExecSql = new Proxy(db.execSql, {
      apply: (target, _receiver, args: Parameters<ExecSql>) => {
        if (
          armed &&
          failProjection &&
          args[0].startsWith('insert into "document_container_projection"')
        ) {
          throw new Error("projection write failed");
        }
        return target(...args);
      },
    });
    try {
      await documents.ensureSchema(execSql);
      const fixture = await createRemoteHistoryFixture();
      const documentId = fixture.writerProjection.documentId;
      await persistFullHistoryDocument({
        doc: fixture.remoteDocument,
        documentId,
        execSql,
        localId: "local",
      });
      await links.replaceDocumentLinks(execSql, documentId, [
        "source-container",
      ]);
      const runtime = createRotationRecoveryRuntime({
        execSql,
        fixture,
        online: false,
      });
      const published: string[] = [];
      const state = createDocumentStoreState(
        "local",
        runtime,
        documents,
        {
          ...noopDocumentStorePersistenceEffects,
          emitPersistedDocument: (_scope, summary) => {
            published.push(summary.containerId ?? "");
          },
        },
        documentId,
      );
      await ensureDocumentStoreReady(state, () => {});
      published.length = 0;
      const store: DocumentStructuralMutationLocalStore<null> = {
        assertCanRotateContentKey: async () => new Uint8Array(),
        ensureInitialized: async () => true,
        relink: (input) =>
          relinkDocumentStore(state, input, () => {}, input.commitSideEffect),
        requestSync: () => {},
        updateRuntime: () => {},
      };
      armed = true;
      const move = moveRemoteDocumentLinkLocally({
        currentDocumentStore: store,
        expandNode: () => {},
        host: {
          documentWorkflowRuntime: () => null,
          mergeDocumentSummary: () => {},
          openDocumentStore: () => store,
        },
        note: {
          id: "local",
          documentId,
          containerId: "source-container",
          title: "Move",
          updatedAt: "2026-09-17T00:00:00.000Z",
        },
        replaceLinkedContainers: true,
        runtime: runtime as unknown as DocumentStructuralMutationRuntime,
        setLinkedContainerIdsForDocument: () => {},
        targetContainerId: "trash",
      });
      if (failProjection)
        await expect(move).rejects.toThrow("document_container_projection");
      else expect((await move).note?.containerId).toBe("trash");
      const expectedContainer = failProjection ? "source-container" : "trash";
      expect(await documents.loadDocument(execSql, "local")).toMatchObject({
        containerId: expectedContainer,
      });
      expect(await links.listLinkedContainerIds(execSql, documentId)).toEqual([
        expectedContainer,
      ]);
      expect(await intents.listPendingMoveIntents(execSql)).toHaveLength(
        failProjection ? 0 : 1,
      );
      expect(published).toEqual(failProjection ? [] : ["trash"]);
    } finally {
      db.close();
    }
  },
);
