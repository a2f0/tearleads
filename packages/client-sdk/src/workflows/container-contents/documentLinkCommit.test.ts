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
import { listContainerContentsDocumentsForContainers } from "./documentSubtreeQueries";

test.each([
  { online: false, failProjection: false },
  { online: true, failProjection: false },
  { online: false, failProjection: true },
])(
  "creating a link commits locally despite unavailable network: %j",
  async ({ online, failProjection }) => {
    const db = await createTestExecSql(
      `link-commit-${online}-${failProjection}`,
    );
    let armed = false;
    const execSql: ExecSql = new Proxy(db.execSql, {
      apply: (target, _receiver, args: Parameters<ExecSql>) => {
        if (
          armed &&
          failProjection &&
          args[0].startsWith('insert into "document_container_projection"')
        )
          throw new Error("projection write failed");
        return target(...args);
      },
    });
    let unsubscribe = () => {};
    const network = Promise.withResolvers<null>();
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
      const networkRequests: string[] = [];
      const initialWorkflow = createWorkflowInputFixture({
        execSql,
        apiClient: createMockApiClient({
          getDocumentWriterProjection: async () => {
            networkRequests.push("projection");
            return network.promise;
          },
        }),
        online,
        auth: {
          organizationId: fixture.author.organizationId,
          userId: fixture.author.signerUserId,
        },
        containerId: "source-container",
      });
      const workflow = {
        ...initialWorkflow,
        crypto: online
          ? {
              encapsulationKeyPair: {
                publicKey: fixture.publicKey,
                secretKey: fixture.secretKey,
              },
              signingFingerprint: fixture.author.signerKeyFingerprint,
              signingKeyPair: {
                signingPrivateKey: fixture.author.signerPrivateKey,
                signingPublicKey: fixture.signingPublicKey,
              },
            }
          : initialWorkflow.crypto,
      };
      const contents = createContainerContents(
        createInternalRuntimeFixture(() => workflow),
      );
      const documentLinks = contents.documentLinks();
      const published: boolean[] = [];
      const linkChanges: (readonly string[])[] = [];
      unsubscribe = subscribeToPersistedDocuments(
        workflow.state.domainScope,
        (_, change) => {
          published.push(change.placementChanged);
        },
      );
      armed = true;
      const link = documentLinks.linkDocumentToContainer({
        mergeDocumentSummary: () => {},
        note: {
          id: "local",
          documentId,
          containerId: "source-container",
          title: "Link",
          updatedAt: "2026-09-18T00:00:00.000Z",
        },
        setLinkedContainerIdsForDocument: (_, ids) => {
          linkChanges.push(ids);
        },
        targetContainerId: "destination",
      });
      if (failProjection)
        await expect(link).rejects.toThrow("document_container_projection");
      else
        expect(await link).toMatchObject({
          id: "local",
          containerId: "source-container",
        });
      if (!online) expect(networkRequests).toEqual([]);
      const expectedLinks = failProjection
        ? ["source-container"]
        : ["destination", "source-container"];
      expect(await links.listLinkedContainerIds(execSql, documentId)).toEqual(
        expectedLinks,
      );
      expect(await documents.loadDocument(execSql, "local")).toMatchObject({
        containerId: "source-container",
        accessEpoch: 1,
      });
      expect(await intents.listPendingMoveIntents(execSql)).toHaveLength(
        failProjection ? 0 : 1,
      );
      expect(published).toEqual(failProjection ? [] : [true]);
      expect(linkChanges).toEqual(failProjection ? [] : [expectedLinks]);
      if (!failProjection) {
        // A stale server listing must not hide the locally committed link.
        await links.replaceDocumentLinks(execSql, documentId, [
          "source-container",
        ]);
        expect(await links.listLinkedContainerIds(execSql, documentId)).toEqual(
          expectedLinks,
        );
        const destination = await listContainerContentsDocumentsForContainers(
          execSql,
          ["destination"],
          { sortDocumentSummaries: false },
        );
        expect(
          destination.documentSummaries.map((document) => document.id),
        ).toEqual(["local"]);
      }
    } finally {
      unsubscribe();
      network.resolve(null);
      db.close();
    }
  },
);
