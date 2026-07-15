import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { advanceLocallyAcknowledgedAccessManifestHeadsAtomically } from "../../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { createRemoteContainerWithMetadataDocument } from "./createWithMetadata";

test("container-with-metadata acknowledgement pins both heads atomically", async () => {
  const parent = await createParentProjection();
  const containerId = "container-with-conflicting-metadata-pin";
  const conflictingHash = "a".repeat(64);
  const { close, execSql } = await createTestExecSql(
    "container-with-metadata-atomic-checkpoints",
  );
  const apiClient = createMockApiClient({
    createContainerWithMetadataDocument: async (request) => ({
      container: await createMutationResponseFromRequest(request.container),
      metadataDocument: await createResponseFromRequest(
        request.metadataDocument,
      ),
    }),
  });
  const runtime = createContainerContentsWorkflowRuntime({
    apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: parent.projection.organizationId,
      userId: parent.userId,
    },
    crypto: {
      encapsulationKeyPair: {
        publicKey: parent.encapsulationPublicKey,
        secretKey: parent.secretKey,
      },
      signingFingerprint: parent.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: parent.author.signerPrivateKey,
        signingPublicKey: parent.signingPublicKey,
      },
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    state: {
      containerId: parent.projection.containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => undefined,
      log: () => undefined,
    },
  });

  try {
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql,
      heads: [
        {
          checkpoint: {
            epoch: 1,
            manifestHash: conflictingHash,
            objectId: containerId,
            objectKind: "document",
            organizationId: parent.projection.organizationId,
          },
          previousManifestHash: null,
        },
      ],
    });
    await expect(
      createRemoteContainerWithMetadataDocument({
        containerId,
        parentContainerId: parent.projection.containerId,
        parentProjection: parent.projection,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        runtime,
      }),
    ).rejects.toMatchObject({ code: "equivocation" });
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        parent.projection.organizationId,
        containerId,
      ),
    ).resolves.toBeNull();
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "document",
        parent.projection.organizationId,
        containerId,
      ),
    ).resolves.toMatchObject({ manifestHash: conflictingHash });
  } finally {
    close();
  }
});
