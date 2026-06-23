import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
} from "../../../test/helpers/documentFixtures";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { defaultDocumentsPersistence } from "../documents";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import { syncPendingDocumentMoveIntents } from "./documentMoveIntentSync";
import type { DocumentStructuralMutationRelinkInput } from "./documentStructure";
import type { ContainerState } from "./remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

function remoteContainerState(input: {
  id: string;
  parentId: string | null;
}): ContainerState {
  return {
    container: {
      id: input.id,
      icon: null,
      metadataDocumentId: `metadata-${input.id}`,
      name: input.id,
      organizationId: "organization",
      parentId: input.parentId,
      systemSlot: null,
    },
    doc: {} as ContainerState["doc"],
    record: {
      accessEpoch: 1,
      accessStateHash: `access-${input.id}`,
      documentId: `metadata-${input.id}`,
      id: `record-${input.id}`,
      loroSnapshot: "",
    },
  };
}

test("pending document move intents replay signed link-set mutations and clear after success", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-move-intent-sync",
  );

  try {
    const { author, signingPublicKey } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const rootProjection = await createContainerWriterProjectionFixture({
      containerId: "queued-move-root-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const trashProjection = await createContainerWriterProjectionFixture({
      containerId: "queued-move-trash-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      parentProjection: rootProjection,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const resolveProjectionUserKey = async (userId: string) =>
      userId === author.signerUserId
        ? {
            encapsulationPublicKey: keyPair.publicKey,
            signingPublicKey,
            userId,
          }
        : null;
    const created = await buildMaterializedDocumentCreatePlan({
      author,
      containerProjection: rootProjection,
      documentId: "queued-move-document",
      resolveProjectionUserKey,
      targetSecretKey: keyPair.secretKey,
    });
    const createdResponse = createResponse(created.plan);
    let writerProjection: DocumentWriterProjectionResponse = {
      authorizingContainerPaths: [rootProjection],
      contentKeyBundle: createdResponse.contentKeyBundle,
      documentId: createdResponse.id,
      documentKekTargets: createdResponse.documentKekTargets,
      documentManifest: createdResponse.accessManifest,
    };

    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: createdResponse.accessManifest.manifestHash,
      containerId: rootProjection.containerId,
      contentKeyBundle: null,
      documentId: writerProjection.documentId,
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: "queued-move-local",
      lastCommitLsn: null,
      loroSnapshot: "",
      text: "",
      title: "Queued move",
    });
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      writerProjection.documentId,
      [rootProjection.containerId],
    );
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: writerProjection.documentId,
      localId: "queued-move-local",
      replaceLinkedContainers: true,
      sourceContainerId: rootProjection.containerId,
      targetContainerId: trashProjection.containerId,
    });

    const relinkInputs: DocumentStructuralMutationRelinkInput[] = [];
    const submittedOperations: string[] = [];
    const runtime: ContainerContentsWorkflowRuntime = {
      apiClient: {
        getContainerWriterProjection: async (containerId: string) => {
          if (containerId === rootProjection.containerId) {
            return rootProjection;
          }
          if (containerId === trashProjection.containerId) {
            return trashProjection;
          }
          return null;
        },
        getDocumentWriterProjection: async (documentId: string) =>
          documentId === writerProjection.documentId ? writerProjection : null,
        primeDocumentWriterProjection: () => {},
        linkDocument: async (
          documentId: string,
          request: DocumentLinkSetMutationRequest,
        ) => {
          submittedOperations.push("link");
          const response = await createLinkSetResponseFromRequest(
            documentId,
            request,
          );
          writerProjection = {
            authorizingContainerPaths: [rootProjection, trashProjection],
            contentKeyBundle: response.contentKeyBundle,
            documentId: response.id,
            documentKekTargets: response.documentKekTargets,
            documentManifest: response.accessManifest,
            documentManifestHistory: [createdResponse.accessManifest],
          };
          return response;
        },
        unlinkDocument: async (
          documentId: string,
          request: DocumentLinkSetMutationRequest,
        ) => {
          submittedOperations.push("unlink");
          const response = await createLinkSetResponseFromRequest(
            documentId,
            request,
          );
          writerProjection = {
            authorizingContainerPaths: [trashProjection],
            contentKeyBundle: response.contentKeyBundle,
            documentId: response.id,
            documentKekTargets: response.documentKekTargets,
            documentManifest: response.accessManifest,
          };
          return response;
        },
      } as unknown as ContainerContentsWorkflowRuntime["apiClient"],
      auth: {
        isAuthenticated: true,
        organizationId: author.organizationId,
        userId: author.signerUserId,
      },
      crypto: {
        encapsulationKeyPair: keyPair,
        signingFingerprint: author.signerKeyFingerprint,
        signingKeyPair: {
          signingPrivateKey: author.signerPrivateKey,
          signingPublicKey,
        },
      },
      getEncapsulationKey: async () => null,
      infra: {
        blobStore: null as never,
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      state: {
        containerId: null,
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        cacheReferencedPrincipalPolicies: async () => undefined,
        log: () => undefined,
      },
    };

    const syncedCount = await syncPendingDocumentMoveIntents({
      host: {
        documentWorkflowRuntime: (containerId) => `runtime:${containerId}`,
        openDocumentStore: () => ({
          ensureInitialized: async () => true,
          relink: async (input) => {
            relinkInputs.push(input);
            return {
              containerId: input.containerId,
              documentId: input.documentId,
              id: input.localId,
              title: "Queued move",
              updatedAt: "2026-06-23T00:00:00.000Z",
            };
          },
          requestSync: () => undefined,
          updateRuntime: () => undefined,
        }),
      },
      state: {
        containersById: new Map([
          [
            trashProjection.containerId,
            remoteContainerState({
              id: trashProjection.containerId,
              parentId: rootProjection.containerId,
            }),
          ],
        ]),
        resolveProjectionUserKey,
        runtime,
      },
    });

    expect(syncedCount).toBe(1);
    expect(submittedOperations).toEqual(["link", "unlink"]);
    expect(relinkInputs).toHaveLength(1);
    expect(relinkInputs[0]).toMatchObject({
      containerId: trashProjection.containerId,
      documentId: writerProjection.documentId,
      localId: "queued-move-local",
      queueBaselineAfterRelink: true,
    });
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        writerProjection.documentId,
      ),
    ).resolves.toEqual([trashProjection.containerId]);
    await expect(
      sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});
