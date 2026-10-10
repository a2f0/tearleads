import { expect, test } from "bun:test";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { sqlContainerContentsPersistence as persistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence as documents } from "../../../data/persistence/documents/documentsPersistence";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../containers/child/create";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { purgeContainerTree } from "./purgeTree";

for (const race of ["none", "move", "intent"] as const) {
  test(`local subtree ancestry stays current during remote verification (${race})`, async () => {
    const parent = await createParentProjection();
    const created = await buildMaterializedContainerCreatePlan({
      author: parent.author,
      parentProjection: parent.projection,
      parentSecretKey: parent.secretKey,
      trustedLocalProjection: true,
    });
    const projection = childContainerWriterProjectionFromCreatePlan({
      materializedPlan: created,
      parentProjection: parent.projection,
    });
    await withTestExecSql("mixed-purge-race", async (execSql) => {
      await persistence.ensureSchema(execSql);
      await documents.ensureSchema(execSql);
      const containersById = new Map<string, ContainerState>();
      for (const [id, parentId, remoteId] of [
        [parent.projection.containerId, null, null],
        [
          projection.containerId,
          parent.projection.containerId,
          created.plan.metadataDocumentId,
        ],
        ["local-child", projection.containerId, null],
      ] as const) {
        const container = {
          id,
          parentId,
          organizationId: projection.organizationId,
          name: id,
          icon: null,
          metadataDocumentId: remoteId ?? `${id}-metadata`,
        };
        const record = {
          id,
          documentId: remoteId,
          accessEpoch: 1,
          snapshotEndVersion: "",
          metadataUpdates: "",
        };
        await persistence.saveContainer(execSql, container, record);
        containersById.set(id, {
          container,
          record,
          doc: await createContainerMetadataDocument(id),
        });
      }
      await documents.saveDocument(execSql, {
        id: "local-note",
        documentId: null,
        containerId: "local-child",
        accessEpoch: 1,
        documentKind: "note",
        snapshotEndVersion: "",
        text: "Restored work",
        title: "Note",
      });
      let projectionReads = 0;
      const controller = new AbortController();
      const result = await purgeContainerTree({
        containersById,
        persistence,
        keepRootContainer: true,
        rootContainerId: parent.projection.containerId,
        prepareDocumentRotationSnapshot: async () => null,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        // Stop after the first real document operation: container deletion is
        // irrelevant to whether stale scope already destroyed its local note.
        onProgress: (progress) => {
          if (progress.completedCount + progress.failedCount > 0)
            controller.abort();
        },
        signal: controller.signal,
        runtime: {
          apiClient: {
            evictContainerWriterProjection: () => {},
            getContainerWriterProjection: async () => {
              projectionReads += 1;
              const local = containersById.get("local-child");
              if (!local) throw new Error("Missing local child");
              if (race !== "none")
                await persistence.saveContainer(
                  execSql,
                  { ...local.container, parentId: "outside" },
                  local.record,
                  race === "intent"
                    ? {
                        moveIntent: {
                          parentContainerId: "outside",
                          previousParentContainerId: projection.containerId,
                        },
                      }
                    : undefined,
                );
              return projection;
            },
            getCurrentPrincipalPolicy: async () => null,
          },
          auth: {
            organizationId: projection.organizationId,
            rootContainerId: parent.projection.containerId,
            userId: parent.userId,
          },
          infra: {
            execSql,
            blobStore: createMemoryBlobStore(),
            documentProjectors: defaultDocumentProjectorRegistry,
          },
          resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
            userId: parent.userId,
            signingKeyFingerprint: parent.author.signerKeyFingerprint,
            signingPublicKey: parent.signingPublicKey,
            encapsulationPublicKey: parent.encapsulationPublicKey,
          }),
          util: { log: () => {}, reportSecurityIncident: async () => {} },
        } as unknown as ContainerContentsWorkflowRuntime,
      });
      expect(projectionReads).toBeGreaterThan(0);
      expect(result?.completedCount).toBe(race === "none" ? 1 : 0);
      expect(
        (await documents.loadDocument(execSql, "local-note")) !== null,
      ).toBe(race !== "none");
    });
  });
}
