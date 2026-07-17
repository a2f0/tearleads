import { expect, test } from "bun:test";
import { decryptWithDek } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ContainerCreateWithMetadataDocumentRequest } from "@tearleads/validators/request";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { unwrapDocumentContentKeyTarget } from "../../../data/documents/shared/projection";
import { createDomainScope } from "../../../data/domainScope";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { advanceLocallyAcknowledgedAccessManifestHeadsAtomically } from "../../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { createRemoteContainerWithMetadataDocument } from "./createWithMetadata";

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = Reflect.get(record, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${key}`);
  }
  return value;
}

async function unwrapCreatedKeys(
  request: ContainerCreateWithMetadataDocumentRequest,
  parentContainerKek: Uint8Array,
): Promise<{ containerKey: Uint8Array; metadataContentKey: Uint8Array }> {
  const parentWrap = request.container.wraps.find(
    (wrap) => Reflect.get(wrap, "recipientKind") === "container",
  );
  const metadataEnvelope = request.metadataDocument.contentKeyBundle.targets[0];
  if (!parentWrap || !metadataEnvelope) {
    throw new Error("Expected container and metadata key wraps");
  }
  const containerKey = await decryptWithDek(
    {
      ciphertext: base64ToBytes(requiredString(parentWrap, "wrappedKey")),
      iv: base64ToBytes(requiredString(parentWrap, "kemCipherText")),
    },
    parentContainerKek,
  );
  const metadataContentKey = await unwrapDocumentContentKeyTarget({
    containerKek: containerKey,
    envelope: metadataEnvelope,
  });
  return { containerKey, metadataContentKey };
}

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
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: parent.projection.containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
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

test("container-with-metadata replans after the parent head advances", async () => {
  const parent = await createParentProjection();
  const containerId = "container-with-stale-parent-retry";
  const submittedRequests: ContainerCreateWithMetadataDocumentRequest[] = [];
  let evictions = 0;
  let projectionReads = 0;
  let reported = false;
  const { close, execSql } = await createTestExecSql(
    "container-with-stale-parent-retry",
  );
  const apiClient = createMockApiClient({
    createContainerWithMetadataDocumentResult: async (request) => {
      submittedRequests.push(request);
      if (submittedRequests.length === 1) {
        return {
          kind: "http" as const,
          message:
            "POST /containers/with-metadata-document: 409 Conflict: parentContainerPath[0] manifest head is stale",
          method: "POST" as const,
          ok: false as const,
          path: "/containers/with-metadata-document",
          report: () => {
            reported = true;
          },
          status: 409,
          statusText: "Conflict",
        };
      }

      return {
        data: {
          container: await createMutationResponseFromRequest(request.container),
          metadataDocument: await createResponseFromRequest(
            request.metadataDocument,
          ),
        },
        ok: true as const,
      };
    },
    evictContainerWriterProjection: (parentContainerId) => {
      expect(parentContainerId).toBe(parent.projection.containerId);
      evictions += 1;
    },
    getContainerWriterProjection: async (parentContainerId) => {
      expect(parentContainerId).toBe(parent.projection.containerId);
      projectionReads += 1;
      return parent.projection;
    },
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
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: parent.projection.containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
    },
  });

  try {
    const created = await createRemoteContainerWithMetadataDocument({
      containerId,
      parentContainerId: parent.projection.containerId,
      parentProjection: parent.projection,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      runtime,
    });

    expect(created?.containerId).toBe(containerId);
    expect(submittedRequests).toHaveLength(2);
    expect(evictions).toBe(1);
    expect(projectionReads).toBe(1);
    expect(reported).toBe(false);
    const [firstRequest, retryRequest] = submittedRequests;
    if (!firstRequest || !retryRequest) {
      throw new Error("Expected the original and retried requests");
    }
    expect(Reflect.get(retryRequest.container.event, "eventId")).toBe(
      Reflect.get(firstRequest.container.event, "eventId"),
    );
    expect(Reflect.get(retryRequest.container.event, "signedAt")).toBe(
      Reflect.get(firstRequest.container.event, "signedAt"),
    );
    expect(Reflect.get(retryRequest.container.keyEpoch, "id")).toBe(
      Reflect.get(firstRequest.container.keyEpoch, "id"),
    );
    expect(Reflect.get(retryRequest.metadataDocument.event, "eventId")).toBe(
      Reflect.get(firstRequest.metadataDocument.event, "eventId"),
    );
    expect(Reflect.get(retryRequest.metadataDocument.event, "signedAt")).toBe(
      Reflect.get(firstRequest.metadataDocument.event, "signedAt"),
    );
    const firstKeys = await unwrapCreatedKeys(
      firstRequest,
      parent.parentContainerKek,
    );
    const retryKeys = await unwrapCreatedKeys(
      retryRequest,
      parent.parentContainerKek,
    );
    expect(Array.from(retryKeys.containerKey)).toEqual(
      Array.from(firstKeys.containerKey),
    );
    expect(Array.from(retryKeys.metadataContentKey)).toEqual(
      Array.from(firstKeys.metadataContentKey),
    );
  } finally {
    close();
  }
});
