import { expect, test } from "bun:test";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../../test/helpers/documentPurge";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { sqlContainerContentsPersistence as persistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { purgeContainerTree } from "./purgeTree";

// The signed path places the selected root under materialized-sync-parent. A
// root selected under another parent (a settled restore elsewhere, or a listing
// that misplaced it) must not authorize the documents it holds directly, whether
// they cite a signed purge request or are local-only.
for (const capturedParentId of ["materialized-sync-parent", "trash"]) {
  test(`root documents keep the selected root parent (${capturedParentId})`, async () => {
    const fixture = await createMaterializedSyncFixture({
      nestedContainer: true,
    });
    const { author, writerProjection } = fixture;
    const rootId = fixture.projection.containerId;
    expect(
      Reflect.get(
        fixture.projection.path.at(-1)?.state ?? {},
        "parentContainerId",
      ),
    ).toBe("materialized-sync-parent");
    const proof = await createDocumentPurgeProof(author, writerProjection);
    await withTestExecSql("purge-root-parent", async (execSql) => {
      await persistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const root: ContainerState = {
        container: {
          id: rootId,
          parentId: capturedParentId,
          organizationId: author.organizationId,
          name: "Selected",
          icon: null,
          metadataDocumentId: "root-metadata",
        },
        record: {
          id: rootId,
          documentId: "root-metadata",
          accessEpoch: 1,
          snapshotEndVersion: "",
          metadataUpdates: "",
        },
        doc: await createContainerMetadataDocument(rootId),
      };
      await persistence.saveContainer(execSql, root.container, root.record);
      await sqlDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: "document-state",
          containerId: rootId,
          documentId: writerProjection.documentId,
          documentKind: "note",
          id: "local-note",
          snapshotEndVersion: "",
          text: "Keep restored work",
          title: "Note",
        },
        { updatedAt: "2026-10-01T00:00:00.000Z" },
      );
      await sqlDocumentsPersistence.saveDocument(execSql, {
        accessEpoch: 1,
        containerId: rootId,
        documentId: null,
        documentKind: "note",
        id: "local-only-note",
        snapshotEndVersion: "",
        text: "Unsynced restored work",
        title: "Local note",
      });
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
        execSql,
        writerProjection.documentId,
        [rootId],
      );
      let purges = 0;
      const requiredAncestorIds: unknown[] = [];
      await purgeContainerTree({
        containersById: new Map([[rootId, root]]),
        rootContainerId: rootId,
        persistence,
        prepareDocumentRotationSnapshot: async () => null,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        runtime: {
          apiClient: {
            evictContainerWriterProjection: () => undefined,
            getContainerWriterProjection: async () => fixture.projection,
            getCurrentPrincipalPolicy: async () => null,
            getDocumentPurgeProof: async () => null,
            getDocumentWriterProjectionResult: async () => ({
              data: writerProjection,
              ok: true,
            }),
            purgeDocument: async () => {
              purges += 1;
              return { ...proof, reclaimedBlobStorageKeys: [] };
            },
            deleteContainerResult: async (
              _containerId: string,
              options: { requiredAncestorId?: string },
            ) => {
              requiredAncestorIds.push(options.requiredAncestorId);
              return { ok: false, status: 409, report: () => {} };
            },
          },
          auth: {
            isAuthenticated: true,
            organizationId: author.organizationId,
            userId: author.signerUserId,
          },
          crypto: {
            encapsulationKeyPair: {
              publicKey: fixture.publicKey,
              secretKey: fixture.secretKey,
            },
            signingFingerprint: author.signerKeyFingerprint,
            signingKeyPair: {
              signingPrivateKey: author.signerPrivateKey,
              signingPublicKey: fixture.signingPublicKey,
            },
          },
          infra: {
            blobStore: createMemoryBlobStore(),
            dbStatus: "ready",
            documentProjectors: defaultDocumentProjectorRegistry,
            execSql,
          },
          resolveTrustedUserIdentity: async () => null,
          util: { log: () => {}, reportSecurityIncident: async () => {} },
        } as unknown as ContainerContentsWorkflowRuntime,
      });
      const restored = capturedParentId === "trash";
      expect(purges).toBe(restored ? 0 : 1);
      for (const localId of ["local-note", "local-only-note"])
        expect(
          (await sqlDocumentsPersistence.loadDocument(execSql, localId)) !==
            null,
        ).toBe(restored);
      // The root's own DELETE asks the server to keep it under that parent.
      expect(requiredAncestorIds).toEqual([capturedParentId]);
    });
  });
}
