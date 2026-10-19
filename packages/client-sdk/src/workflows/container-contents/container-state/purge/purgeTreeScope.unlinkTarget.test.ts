import { expect, test } from "bun:test";
import { createDocument, exportFullHistorySnapshot } from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createMockRequestFailure,
} from "@tearleads/test-utils";
import {
  createLinkSetResponseFromRequest,
  createMaterializedSyncFixture,
  writerProjectionEvidence,
} from "../../../../../test/helpers/documentFixtures";
import { withTestExecSql } from "../../../../../test/helpers/withTestExecSql";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { createContainerMetadataDocument } from "../../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { sqlContainerContentsPersistence as persistence } from "../../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../../../documents/linkSet";
import type { ContainerState } from "../../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../../runtime";
import { purgeContainerTree } from "./purgeTree";

async function createLinkedFixture() {
  const source = await createMaterializedSyncFixture();
  const path = source.writerProjection.authorizingContainerPaths[0];
  if (!path) throw new Error("Expected root projection");
  const root = Object.assign(path, {
    policyEvidence: source.writerProjection.policyEvidence,
  });
  const child = await createContainerWriterProjectionFixture({
    containerId: crypto.randomUUID(),
    encapsulationPublicKey: source.publicKey,
    organizationId: source.author.organizationId,
    parentProjection: root,
    signerKeyFingerprint: source.author.signerKeyFingerprint,
    signerPrivateKey: source.author.signerPrivateKey,
    userId: source.author.signerUserId,
  });
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author: source.author,
    operation: "link",
    prepareBlobRewraps: async () => [],
    targetContainerProjection: child,
    targetSecretKey: source.secretKey,
    trustedLocalProjection: true,
    writerProjection: source.writerProjection,
  });
  const response = await createLinkSetResponseFromRequest(
    source.writerProjection.documentId,
    linked.plan.request,
  );
  return {
    ...source,
    root,
    child,
    writerProjection: {
      ...source.writerProjection,
      authorizingContainerPaths: [root, child],
      ...writerProjectionEvidence(
        [root, child],
        [source.writerProjection.documentManifest],
      ),
      contentKeyBundle: response.contentKeyBundle,
      documentKekTargets: response.documentKekTargets,
      documentManifest: response.accessManifest,
    },
  };
}

function containerState(input: {
  id: string;
  organizationId: string;
  parentId: string | null;
}): Promise<ContainerState> {
  return createContainerMetadataDocument(input.id).then((doc) => ({
    container: {
      ...input,
      name: input.id,
      icon: null,
      metadataDocumentId: `${input.id}-metadata`,
    },
    record: {
      id: input.id,
      documentId: `${input.id}-metadata`,
      accessEpoch: 1,
      snapshotEndVersion: "",
      metadataUpdates: "",
    },
    doc,
  }));
}

// D is linked in the selected root and in its child B. The purge first unlinks
// D from B, then destroys D. A restore of B queued while the unlink is being
// prepared must stop that unlink, not only the document's own placement.
for (const restoreDuringPreparation of [false, true]) {
  test(`subtree unlink rechecks its own target before dispatch (${restoreDuringPreparation})`, async () => {
    const fixture = await createLinkedFixture();
    const { author, writerProjection } = fixture;
    const organizationId = author.organizationId;
    await withTestExecSql("purge-unlink-target", async (execSql) => {
      await persistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const root = await containerState({
        id: fixture.root.containerId,
        organizationId,
        parentId: null,
      });
      const child = await containerState({
        id: fixture.child.containerId,
        organizationId,
        parentId: root.container.id,
      });
      for (const state of [root, child])
        await persistence.saveContainer(execSql, state.container, state.record);
      await sqlDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: "document-state",
          containerId: root.container.id,
          documentId: writerProjection.documentId,
          documentKind: "note",
          id: "local-note",
          snapshotEndVersion: "",
          text: "Keep linked work",
          title: "Note",
        },
        { updatedAt: "2026-10-01T00:00:00.000Z" },
      );
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
        execSql,
        writerProjection.documentId,
        [root.container.id, child.container.id],
      );
      let unlinks = 0;
      let purges = 0;
      const deletes: unknown[] = [];
      await purgeContainerTree({
        containersById: new Map([
          [root.container.id, root],
          [child.container.id, child],
        ]),
        keepRootContainer: true,
        rootContainerId: root.container.id,
        persistence,
        prepareDocumentRotationSnapshot: async () => {
          // The user restores B after the upfront checks have passed.
          if (restoreDuringPreparation)
            await persistence.saveContainer(
              execSql,
              { ...child.container, parentId: "restored" },
              null,
              {
                moveIntent: {
                  parentContainerId: "restored",
                  previousParentContainerId: root.container.id,
                },
              },
            );
          return exportFullHistorySnapshot(await createDocument("unlink"));
        },
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        runtime: {
          apiClient: createMockApiClient({
            getContainerWriterProjection: async (containerId) =>
              containerId === fixture.child.containerId
                ? fixture.child
                : fixture.root,
            getDocumentWriterProjection: async () => writerProjection,
            listDocumentAttachments: async () => [],
            primeDocumentWriterProjection: () => {},
            unlinkDocument: async (documentId, request) => {
              unlinks += 1;
              return createLinkSetResponseFromRequest(documentId, request);
            },
            // Only the unlink dispatch is under test; once it is sent, the purge
            // step stops at its projection read instead of verifying the
            // pre-unlink fixture against the newer local checkpoint.
            getDocumentWriterProjectionResult: async () =>
              unlinks === 0
                ? { ok: true, data: writerProjection }
                : createMockRequestFailure({
                    message: "unavailable",
                    method: "GET",
                    path: "/documents/writer-projection",
                    status: 503,
                  }),
            purgeDocument: async () => {
              purges += 1;
              return null;
            },
            deleteContainerResult: async (containerId, options) => {
              deletes.push({
                containerId,
                requiredAncestorId: options?.requiredAncestorId,
              });
              return createMockRequestFailure({
                message: "conflict",
                method: "DELETE",
                path: `/containers/${containerId}`,
                status: 409,
              });
            },
          }),
          auth: {
            isAuthenticated: true,
            organizationId,
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
      expect(unlinks).toBe(restoreDuringPreparation ? 0 : 1);
      // The emptied descendant's DELETE stays bound to the selected root.
      expect(deletes).toEqual(
        restoreDuringPreparation
          ? []
          : [
              {
                containerId: child.container.id,
                requiredAncestorId: root.container.id,
              },
            ],
      );
      if (restoreDuringPreparation) {
        expect(purges).toBe(0);
        expect(
          await sqlDocumentsPersistence.loadDocument(execSql, "local-note"),
        ).not.toBeNull();
      }
    });
  });
}
