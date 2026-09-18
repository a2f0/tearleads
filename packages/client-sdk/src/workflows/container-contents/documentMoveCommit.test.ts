import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { createContainerContents } from "../../client/containerContents";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence as documents } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createRemoteHistoryFixture } from "../../stores/documents/documentStore/documentStore.testFixtures";
import { persistFullHistoryDocument } from "../../stores/documents/documentStore/rotationRecoveryHelpers.test";
import { subscribeToPersistedDocuments } from "../../stores/documents/registry";

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
    let unsubscribe = () => {};
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
      const workflow = createWorkflowInputFixture({
        execSql,
        apiClient: createMockApiClient(),
        online: false,
        containerId: "source-container",
      });
      const contents = createContainerContents(
        createInternalRuntimeFixture(() => workflow),
      );
      const documentLinks = contents.documentLinks();
      await documentLinks
        .openDocument({
          localId: "local",
          documentId,
          containerId: "source-container",
        })
        .ensureInitialized();
      const published: string[] = [];
      unsubscribe = subscribeToPersistedDocuments(
        workflow.state.domainScope,
        (summary) => {
          published.push(summary.containerId ?? "");
        },
      );
      armed = true;
      const move = documentLinks.moveDocumentToContainer({
        expandNode: () => {},
        mergeDocumentSummary: () => {},
        note: {
          id: "local",
          documentId,
          containerId: "source-container",
          title: "Move",
          updatedAt: "2026-09-17T00:00:00.000Z",
        },
        replaceLinkedContainers: true,
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
      unsubscribe();
      db.close();
    }
  },
);
