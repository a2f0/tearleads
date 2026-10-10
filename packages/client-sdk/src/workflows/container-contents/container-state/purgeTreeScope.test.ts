import { expect, test } from "bun:test";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentMoveIntentPersistence } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../../containers/child/create";
import { upsertRemoteContainerState } from "../remoteContainerState";
import type {
  ContainerState,
  RemoteContainerHydrationState,
} from "../remoteHydration/types";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { purgeContainerTree } from "./purgeTree";

for (const scenario of [
  "outside",
  "inside",
  "pending-before",
  "pending-during",
] as const)
  test(`subtree purge respects signed ancestry and placement (${scenario})`, async () => {
    const signedInside = scenario !== "outside";
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
    const trashId = signedInside
      ? parent.projection.containerId
      : crypto.randomUUID();
    const listedParent = trashId;
    await withTestExecSql("audit-parent-scope", async (execSql) => {
      await sqlContainerContentsPersistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const documentId = crypto.randomUUID();
      const localId = crypto.randomUUID();
      const queueRestore = () =>
        sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
          documentId,
          localId,
          sourceContainerId: projection.containerId,
          targetContainerId: parent.projection.containerId,
        });
      let purging = false;
      const state = {
        containersById: new Map(),
        persistence: sqlContainerContentsPersistence,
        runtime: {
          apiClient: {
            getContainerWriterProjection: async () => {
              if (purging && scenario === "pending-during")
                await queueRestore();
              return projection;
            },
            deleteContainerResult: async () => ({
              ok: false,
              status: 409,
              report: () => {},
            }),
            getCurrentPrincipalPolicy: async () => null,
            evictContainerWriterProjection: () => undefined,
          },
          auth: {
            organizationId: projection.organizationId,
            rootContainerId: parent.projection.containerId,
            userId: parent.userId,
          },
          infra: { execSql },
          resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
            userId: parent.userId,
            signingKeyFingerprint: parent.author.signerKeyFingerprint,
            signingPublicKey: parent.signingPublicKey,
            encapsulationPublicKey: parent.encapsulationPublicKey,
          }),
          util: { log: () => {}, reportSecurityIncident: async () => {} },
        },
      } as unknown as RemoteContainerHydrationState;
      expect(
        Reflect.get(projection.path.at(-1)?.state ?? {}, "parentContainerId"),
      ).toBe(parent.projection.containerId);
      const hydrated = await upsertRemoteContainerState({
        remoteContainer: {
          id: projection.containerId,
          organizationId: projection.organizationId,
          parentId: listedParent,
          systemSlot: null,
          metadataDocumentId: created.plan.metadataDocumentId,
          metadataAccessEpoch: 1,
          metadataAccessStateHash: "metadata-hash",
          metadataReferencedPrincipals: [],
          effectiveAccessLevel: "admin",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
        state,
        containerIdsWithPendingMetadataUpdates: new Set(),
        containerIdsWithPendingStructuralIntents: new Set(),
        host: {
          updateSnapshot: () => {},
          persistContainerState: async () => {
            throw new Error("expected insert");
          },
        },
      });
      expect(hydrated?.container.parentId).toBe(listedParent);
      const stored = (
        await sqlContainerContentsPersistence.loadContainers(execSql)
      ).find((s) => s.container.id === projection.containerId);
      expect(stored?.container.parentId).toBe(listedParent);
      await sqlDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: "document-state",
          containerId: projection.containerId,
          documentId,
          documentKind: "note",
          id: localId,
          snapshotEndVersion: "",
          text: "",
          title: "Scoped document",
        },
        { updatedAt: "2026-10-01T00:00:00.000Z" },
      );
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
        execSql,
        documentId,
        [projection.containerId],
      );
      state.containersById.set(trashId, {
        container: { id: trashId, parentId: parent.projection.containerId },
      } as ContainerState);
      if (scenario === "pending-before") await queueRestore();
      const controller = new AbortController();
      const planned: string[] = [];
      purging = true;
      await purgeContainerTree({
        containersById: state.containersById,
        keepRootContainer: true,
        rootContainerId: trashId,
        documentOperations: {
          purgeLocal: async () => {
            throw new Error("unexpected local document");
          },
          purgeRemote: async (document) => {
            if (!document.documentId)
              throw new Error("Expected remote document");
            planned.push(document.documentId);
            controller.abort();
            return true;
          },
          unlink: async () => {
            throw new Error("unexpected unlink");
          },
        },
        persistence: sqlContainerContentsPersistence,
        prepareDocumentRotationSnapshot: async () => null,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        runtime: state.runtime as ContainerContentsWorkflowRuntime,
        signal: controller.signal,
      });
      expect(planned).toEqual(scenario === "inside" ? [documentId] : []);
    });
  });
